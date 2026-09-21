const fs = require('node:fs/promises');
const path = require('node:path');
const { google } = require('googleapis');
const { isDryRun } = require('./app-options');
const { loadServiceAccount, log } = require('./utils');

const DAY_MS = 86400000;
const LAG_DAYS = 3; // Search Console data is still settling for the most recent days
const WINDOW_DAYS = 28;
const ROW_LIMIT = 25;
const OPPORTUNITY_MIN_IMPRESSIONS = Number(process.env.GSC_MIN_IMPRESSIONS) || 10; // these sites see ~25 impressions per 28 days; raise it once volume grows

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

function buildWindows(now = Date.now(), days = WINDOW_DAYS) {
  const end = now - LAG_DAYS * DAY_MS;
  const previousEnd = end - days * DAY_MS;
  return {
    days,
    current: { startDate: iso(end - (days - 1) * DAY_MS), endDate: iso(end) },
    previous: { startDate: iso(previousEnd - (days - 1) * DAY_MS), endDate: iso(previousEnd) },
  };
}

// sc-domain:example.com for domain properties; otherwise the URL-prefix property.
function propertyUrl(site) {
  return site.gscProperty || `${new URL(site.baseUrl).origin}/`;
}

// ponytail: rows below site-average CTR are the rewrite shortlist; no seasonality or intent weighting.
function findOpportunities(rows, siteCtr) {
  return rows
    .filter((row) => row.impressions >= OPPORTUNITY_MIN_IMPRESSIONS && row.ctr < siteCtr)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);
}

function renderReport(report) {
  const cell = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/[\r\n]+/g, ' ');
  const pct = (value) => `${(value * 100).toFixed(2)}%`;
  const delta = (current, previous, format) => (previous === undefined ? '-' : `${current - previous >= 0 ? '+' : ''}${format(current - previous)}`);
  const rowTable = (label, rows) => [
    `| ${label} | 點擊 | 曝光 | CTR | 平均排名 |`, '| --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${cell(row.keys[0])} | ${row.clicks} | ${row.impressions} | ${pct(row.ctr)} | ${row.position.toFixed(1)} |`), '',
  ];

  const lines = ['# Search Console 成效報告', '', `產生時間：${report.generatedAt}`,
    `本期：${report.current.startDate} ~ ${report.current.endDate}（${report.days} 天）；對照期：${report.previous.startDate} ~ ${report.previous.endDate}`, '',
    `數字為 Google 實際曝光與點擊。最近約 ${LAG_DAYS} 天的資料尚未定案，已排除在本期之外。`, ''];

  for (const site of report.sites) {
    lines.push(`## ${cell(site.name)}`, '', `資源：${cell(site.siteUrl)}`, '');
    if (site.error) { lines.push(`查詢失敗：${cell(site.error)}`, ''); continue; }
    if (!site.total) { lines.push('本期沒有任何曝光資料。', ''); continue; }

    const before = site.previousTotal;
    lines.push('| 指標 | 本期 | 對照期 | 變化 |', '| --- | --- | --- | --- |',
      `| 點擊 | ${site.total.clicks} | ${before ? before.clicks : '-'} | ${delta(site.total.clicks, before?.clicks, (v) => String(v))} |`,
      `| 曝光 | ${site.total.impressions} | ${before ? before.impressions : '-'} | ${delta(site.total.impressions, before?.impressions, (v) => String(v))} |`,
      `| CTR | ${pct(site.total.ctr)} | ${before ? pct(before.ctr) : '-'} | ${delta(site.total.ctr, before?.ctr, (v) => `${(v * 100).toFixed(2)}pp`)} |`,
      `| 平均排名 | ${site.total.position.toFixed(1)} | ${before ? before.position.toFixed(1) : '-'} | ${delta(site.total.position, before?.position, (v) => v.toFixed(1))} |`, '');

    if (site.queryOpportunities.length) {
      lines.push(`### 優先改寫：曝光 ≥ ${OPPORTUNITY_MIN_IMPRESSIONS} 但 CTR 低於全站平均（${pct(site.total.ctr)}）的查詢`, '', ...rowTable('查詢', site.queryOpportunities));
    }
    if (site.pageOpportunities.length) {
      lines.push('### 優先改寫：同條件的頁面（改 title 與 meta description）', '', ...rowTable('網址', site.pageOpportunities));
    }
    lines.push('### 曝光最高的查詢', '', ...rowTable('查詢', site.queries));
    lines.push('### 曝光最高的頁面', '', ...rowTable('網址', site.pages));
  }
  return lines.join('\n');
}

async function fetchRows(client, siteUrl, range, dimensions) {
  const { data } = await client.searchanalytics.query({
    siteUrl,
    requestBody: { ...range, dimensions, rowLimit: dimensions.length ? ROW_LIMIT : 1, type: 'web' },
  });
  return data.rows || [];
}

async function runSearchConsole(sites, { client, outputDir = 'reports', now = Date.now() } = {}) {
  const windows = buildWindows(now);
  const keyEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!client && (isDryRun() || !keyEnv)) {
    if (!keyEnv && !isDryRun()) log('gsc', 'GOOGLE_SERVICE_ACCOUNT_KEY not set, skipping Search Console');
    for (const site of sites) log('gsc', `${site.name}: would query ${propertyUrl(site)} for ${windows.current.startDate}~${windows.current.endDate}`);
    return 0;
  }

  if (!client) {
    let credentials;
    try {
      credentials = loadServiceAccount(keyEnv);
    } catch (error) {
      log('gsc', `Failed to parse service account key: ${error.message}`);
      return 1;
    }
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] });
    client = google.searchconsole({ version: 'v1', auth });
  }

  const report = { generatedAt: new Date(now).toISOString(), ...windows, sites: [] };
  let failures = 0;

  for (const site of sites) {
    const siteUrl = propertyUrl(site);
    const entry = { name: site.name, siteUrl, pages: [], queries: [], pageOpportunities: [], queryOpportunities: [] };
    try {
      const [total, previousTotal, pages, queries] = await Promise.all([
        fetchRows(client, siteUrl, windows.current, []),
        fetchRows(client, siteUrl, windows.previous, []),
        fetchRows(client, siteUrl, windows.current, ['page']),
        fetchRows(client, siteUrl, windows.current, ['query']),
      ]);
      entry.total = total[0];
      entry.previousTotal = previousTotal[0];
      entry.pages = pages;
      entry.queries = queries;
      if (entry.total) {
        entry.pageOpportunities = findOpportunities(pages, entry.total.ctr);
        entry.queryOpportunities = findOpportunities(queries, entry.total.ctr);
      }
      log('gsc', entry.total
        ? `${site.name}: ${entry.total.clicks} clicks / ${entry.total.impressions} impressions, CTR ${(entry.total.ctr * 100).toFixed(2)}%`
        : `${site.name}: no data for ${siteUrl}`);
    } catch (error) {
      failures++;
      entry.error = error.errors?.[0]?.message || error.message;
      const hint = /permission|not have access/i.test(entry.error) ? '（確認服務帳戶已在 Search Console 加為此資源的使用者）' : '';
      log('gsc', `${site.name}: ${entry.error}${hint}`);
    }
    report.sites.push(entry);
  }

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'gsc.json'), JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.join(outputDir, 'gsc.md'), renderReport(report));
  log('gsc', `Reports saved in ${outputDir}`);
  return failures;
}

module.exports = { buildWindows, propertyUrl, findOpportunities, renderReport, runSearchConsole };
