const fs = require('node:fs/promises');
const path = require('node:path');
const axios = require('axios');
const { chromium } = require('playwright');
const { isDryRun } = require('./app-options');
const { resolveDeclaredUrls, resolveSubmissionTargets, toAbsoluteUrl } = require('./url-resolver');
const { log } = require('./utils');

const requestOptions = {
  timeout: 15000, maxRedirects: 0, maxContentLength: 5 * 1024 * 1024,
  responseType: 'text', validateStatus: () => true,
  headers: { 'User-Agent': 'SiteSEOAudit/1.0' },
};

async function readMetadata(page, html) {
  return page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const meta = (name) => doc.querySelector(`meta[name="${name}" i], meta[property="${name}" i]`)?.getAttribute('content')?.trim() || '';
    return {
      title: doc.querySelector('title')?.textContent.trim() || '',
      description: meta('description'),
      canonical: doc.querySelector('link[rel~="canonical" i]')?.getAttribute('href') || '',
      robots: [...doc.querySelectorAll('meta[name="robots" i], meta[name="googlebot" i]')].map((el) => el.getAttribute('content') || '').join(', '),
      h1: [...doc.querySelectorAll('h1')].map((el) => el.textContent.trim()),
      ogTitle: meta('og:title'), ogDescription: meta('og:description'), ogImage: meta('og:image'),
      invalidJsonLd: [...doc.querySelectorAll('script[type="application/ld+json" i]')].filter((el) => {
        try { JSON.parse(el.textContent); return false; } catch { return true; }
      }).length,
    };
  }, html);
}

// ponytail: full-width chars count as 2 columns; real truncation is pixel-based per font.
const FULL_WIDTH = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;
const TITLE_MAX_COLUMNS = 60;
const DESCRIPTION_MAX_COLUMNS = 160;

function displayColumns(text) {
  return [...text.replace(/\s+/g, ' ').trim()].reduce((sum, char) => sum + (FULL_WIDTH.test(char) ? 2 : 1), 0);
}

// Host-level bot protection (SiteGround sgcaptcha, Cloudflare challenges) answers with a
// challenge page instead of the document. We cannot measure the page, but that is not a site defect,
// so it must not turn CI red. ponytail: signature match; a headless-browser solve is the upgrade path.
const CHALLENGE_MARKERS = /\/\.well-known\/sgcaptcha\/|cdn-cgi\/challenge-platform|Just a moment\.\.\./i;
const CHALLENGE_STATUSES = new Set([202, 403, 429, 503]);

function isBotChallenge(status, body) {
  return CHALLENGE_STATUSES.has(status) && CHALLENGE_MARKERS.test(String(body || ''));
}

function pageIssues(record) {
  const issues = [];
  if (record.error) return [`讀取失敗：${record.error}`];
  if (record.blocked) return [`HTTP ${record.status}：主機的機器人防護回傳驗證頁，本次無法檢查內容（非網站故障）`];
  if (record.status !== 200) return [`HTTP ${record.status}${record.location ? ` → ${record.location}` : ''}，確認此網址是否仍應追蹤`];
  if (!record.html) return ['非 HTML 文件，未進行標題與摘要檢查'];
  if (!record.title) issues.push('缺少 title，補上頁面主題與服務地區');
  else if (displayColumns(record.title) > TITLE_MAX_COLUMNS) issues.push(`title 約 ${Math.ceil(displayColumns(record.title) / 2)} 全形字，搜尋結果約 ${TITLE_MAX_COLUMNS / 2} 字就截斷，把關鍵字與地區前置`);
  if (!record.description) issues.push('缺少 meta description，補上服務特色與明確行動提示');
  else if (displayColumns(record.description) > DESCRIPTION_MAX_COLUMNS) issues.push(`meta description 約 ${Math.ceil(displayColumns(record.description) / 2)} 全形字，摘要約 ${DESCRIPTION_MAX_COLUMNS / 2} 字就截斷，把賣點與行動提示寫在前段`);
  if (/(?:^|[\s,:;])(noindex|none)(?:$|[\s,;])/i.test(`${record.robots}, ${record.xRobotsTag}`)) issues.push('存在 noindex，若要曝光需確認並移除索引封鎖');
  if (!record.canonical) issues.push('缺少 canonical，確認並指定主要網址');
  else {
    try {
      if (toAbsoluteUrl(record.url, record.canonical) !== record.url) issues.push('canonical 指向其他網址，確認是否應改追蹤主要網址');
    } catch { issues.push('canonical 無效或指向其他來源，需確認'); }
  }
  if (!record.h1.some(Boolean)) issues.push('缺少可讀的 H1 主標題');
  if (!record.ogTitle || !record.ogDescription || !record.ogImage) issues.push('社群分享預覽不完整，補齊 og:title、og:description、og:image');
  if (record.invalidJsonLd) issues.push('JSON-LD 無法解析，需修正結構化資料語法');
  return issues;
}

function addDuplicateIssues(pages) {
  for (const key of ['title', 'description']) {
    const groups = new Map();
    for (const page of pages.filter((p) => p.status === 200 && p.html && p[key])) {
      const value = page[key].replace(/\s+/g, ' ').trim();
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(page);
    }
    for (const group of groups.values()) {
      if (group.length > 1) for (const page of group) page.issues.push(`${key} 與其他 ${group.length - 1} 頁重複，改寫為此頁專屬內容`);
    }
  }
}

function renderReport(report) {
  const cell = (value) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/[\r\n]+/g, ' ');
  const lines = ['# SEO 檢查報告', '', `時間：${report.generatedAt}`, '',
    '檢查伺服器回傳的 HTML；不執行網站腳本。此報告不代表 Google 已收錄，也不包含真實曝光、點擊或 CTR。',
    '成效請以 Search Console 同期間的曝光、點擊、CTR 與平均排名比較；robots.txt 規則需另行確認。', ''];
  for (const site of report.sites) {
    lines.push(`## ${cell(site.name)}`, '', `網址來源：${site.source}；已檢查 ${site.pages.length} / ${site.totalUrls} 個網址。`, '',
      `robots.txt：${site.robots.status || site.robots.error}（${site.robots.url}）`, '');
    if (site.warning) lines.push(`注意：${cell(site.warning)}`, '');
    const blocked = site.pages.filter((page) => page.blocked).length;
    if (blocked) lines.push(`注意：${blocked} / ${site.pages.length} 個網址被主機的機器人防護擋下，本次未能檢查內容。`, '');
    if (site.totalUrls > site.pages.length) lines.push('本次達 100 頁上限，其餘網址未檢查。', '');
    lines.push('| 網址 | HTTP | 標題 | 摘要 | 待改善項目 |', '| --- | --- | --- | --- | --- |');
    for (const page of site.pages) lines.push(`| ${cell(page.url)} | ${page.status || '-'} | ${cell(page.title)} | ${cell(page.description)} | ${page.issues.map(cell).join('<br>') || '本次檢查未發現問題'} |`);
    lines.push('');
  }
  return lines.join('\n');
}

async function runAudit(sites, { httpClient = axios, outputDir = 'reports' } = {}) {
  if (isDryRun()) {
    for (const site of sites) log('audit', `${site.name}: would inspect sitemap + ${resolveDeclaredUrls(site).length} declared URLs`);
    return 0;
  }
  const report = { generatedAt: new Date().toISOString(), sites: [] };
  const browser = await chromium.launch({ headless: true });
  let failures = 0;
  try {
    const context = await browser.newContext();
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    for (const site of sites) {
      const { urls, source, warning } = await resolveSubmissionTargets(site, httpClient);
      const entry = { name: site.name, source, warning, totalUrls: urls.length, robots: { url: new URL('/robots.txt', site.baseUrl).href }, pages: [] };
      try {
        const response = await httpClient.get(entry.robots.url, requestOptions);
        entry.robots.status = response.status;
        entry.robots.content = String(response.data);
      } catch (error) { entry.robots.error = error.code || error.message; }
      // ponytail: sequential, first 100 URLs per site; add configurable batches for larger sites.
      for (const url of urls.slice(0, 100)) {
        const record = { url };
        try {
          const response = await httpClient.get(url, requestOptions);
          record.status = response.status;
          record.location = response.headers.location;
          record.xRobotsTag = response.headers['x-robots-tag'] || '';
          record.html = /(?:text\/html|application\/xhtml\+xml)/i.test(response.headers['content-type'] || '');
          record.blocked = isBotChallenge(record.status, response.data);
          if (record.status === 200 && record.html) Object.assign(record, await readMetadata(page, String(response.data)));
        } catch (error) { record.error = error.code || error.message; }
        record.issues = pageIssues(record);
        if (record.error || (record.status >= 400 && !record.blocked)) failures++;
        entry.pages.push(record);
        log('audit', `${url}: ${record.status || record.error}, ${record.issues.length} finding(s)`);
      }
      addDuplicateIssues(entry.pages);
      report.sites.push(entry);
    }
  } finally { await browser.close(); }
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'seo-audit.json'), JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.join(outputDir, 'seo-audit.md'), renderReport(report));
  log('audit', `Reports saved in ${outputDir}`);
  return failures;
}

module.exports = { displayColumns, isBotChallenge, readMetadata, pageIssues, addDuplicateIssues, renderReport, runAudit };
