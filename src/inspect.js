const fs = require('node:fs/promises');
const path = require('node:path');
const axios = require('axios');
const { google } = require('googleapis');
const { isDryRun } = require('./app-options');
const { propertyUrl } = require('./gsc');
const { resolveSubmissionTargets } = require('./url-resolver');
const { loadServiceAccount, log } = require('./utils');

const MAX_URLS_PER_SITE = 50; // ponytail: quota guard; the API allows 2000/day per property.
const CALL_GAP_MS = 500;

function summarize(result) {
  const status = result.indexStatusResult || {};
  const rich = result.richResultsResult;
  return {
    verdict: status.verdict || 'UNKNOWN',
    coverageState: status.coverageState || '',
    robotsTxtState: status.robotsTxtState || '',
    pageFetchState: status.pageFetchState || '',
    lastCrawlTime: status.lastCrawlTime || '',
    googleCanonical: status.googleCanonical || '',
    userCanonical: status.userCanonical || '',
    richResultTypes: (rich?.detectedItems || []).map((item) => item.richResultType).filter(Boolean),
    richResultIssues: (rich?.detectedItems || []).flatMap((item) => (item.items || []).flatMap((entry) => (entry.issues || []).map((issue) => `${issue.issueMessage} (${issue.severity})`))),
  };
}

function renderReport(report) {
  const cell = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/[\r\n]+/g, ' ');
  const lines = ['# 收錄狀態與複合式搜尋結果', '', `產生時間：${report.generatedAt}`, '',
    '資料來自 Search Console 網址審查 API，與「頁面索引」報表同源，但逐一查詢而非整站統計。', ''];

  for (const site of report.sites) {
    lines.push(`## ${cell(site.name)}`, '', `資源：${cell(site.siteUrl)}`, '');
    if (site.error) { lines.push(`查詢失敗：${cell(site.error)}`, ''); continue; }

    const indexed = site.urls.filter((entry) => entry.verdict === 'PASS').length;
    const withRich = site.urls.filter((entry) => entry.richResultTypes?.length).length;
    lines.push(`已收錄 ${indexed} / ${site.urls.length} 個網址；${withRich} 個頁面有 Google 辨識到的結構化資料。`, '',
      '| 網址 | 結果 | 收錄狀態 | 最後檢索 | 複合式搜尋結果 |', '| --- | --- | --- | --- | --- |');
    for (const entry of site.urls) {
      lines.push(`| ${cell(entry.url)} | ${cell(entry.verdict)} | ${cell(entry.error || entry.coverageState)} | ${cell(entry.lastCrawlTime.slice(0, 10))} | ${cell(entry.richResultTypes?.join(', ') || '無')} |`);
    }
    lines.push('');

    const canonicalMismatch = site.urls.filter((entry) => entry.googleCanonical && entry.userCanonical && entry.googleCanonical !== entry.userCanonical);
    if (canonicalMismatch.length) {
      lines.push('### Google 選了不同的標準網址', '', '| 網址 | 你宣告的 canonical | Google 選擇的 |', '| --- | --- | --- |',
        ...canonicalMismatch.map((entry) => `| ${cell(entry.url)} | ${cell(entry.userCanonical)} | ${cell(entry.googleCanonical)} |`), '');
    }
    const issues = site.urls.filter((entry) => entry.richResultIssues?.length);
    if (issues.length) {
      lines.push('### 結構化資料問題', '', ...issues.map((entry) => `- ${cell(entry.url)}：${entry.richResultIssues.map(cell).join('；')}`), '');
    }
  }
  return lines.join('\n');
}

async function runIndexInspection(sites, { client, httpClient = axios, outputDir = 'reports' } = {}) {
  const keyEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!client && (isDryRun() || !keyEnv)) {
    if (!keyEnv && !isDryRun()) log('inspect', 'GOOGLE_SERVICE_ACCOUNT_KEY not set, skipping URL inspection');
    for (const site of sites) log('inspect', `${site.name}: would inspect URLs for ${propertyUrl(site)}`);
    return 0;
  }

  if (!client) {
    let credentials;
    try {
      credentials = loadServiceAccount(keyEnv);
    } catch (error) {
      log('inspect', `Failed to parse service account key: ${error.message}`);
      return 1;
    }
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] });
    client = google.searchconsole({ version: 'v1', auth });
  }

  const report = { generatedAt: new Date().toISOString(), sites: [] };
  let failures = 0;

  for (const site of sites) {
    const siteUrl = propertyUrl(site);
    const entry = { name: site.name, siteUrl, urls: [] };
    const { urls } = await resolveSubmissionTargets(site, httpClient);

    for (const url of urls.slice(0, MAX_URLS_PER_SITE)) {
      try {
        const { data } = await client.urlInspection.index.inspect({ requestBody: { inspectionUrl: url, siteUrl } });
        entry.urls.push({ url, ...summarize(data.inspectionResult || {}) });
      } catch (error) {
        const message = error.errors?.[0]?.message || error.message;
        // A property-level failure repeats for every URL; report it once and move on.
        if (error.code === 403) { entry.error = message; break; }
        failures++;
        entry.urls.push({ url, verdict: 'ERROR', error: message, lastCrawlTime: '' });
      }
      await new Promise((resolve) => setTimeout(resolve, CALL_GAP_MS));
    }

    if (entry.error) {
      failures++;
      log('inspect', `${site.name}: ${entry.error}`);
    } else {
      const indexed = entry.urls.filter((item) => item.verdict === 'PASS').length;
      log('inspect', `${site.name}: ${indexed}/${entry.urls.length} indexed`);
    }
    report.sites.push(entry);
  }

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'index-coverage.json'), JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.join(outputDir, 'index-coverage.md'), renderReport(report));
  log('inspect', `Reports saved in ${outputDir}`);
  return failures;
}

module.exports = { summarize, renderReport, runIndexInspection };
