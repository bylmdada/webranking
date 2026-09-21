const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { getSites } = require('../src/config');
const { displayColumns, isBotChallenge, readMetadata, pageIssues, addDuplicateIssues, runAudit } = require('../src/audit');
const { buildWindows, runSearchConsole } = require('../src/gsc');
const { runIndexInspection } = require('../src/inspect');
const { submitToIndexNow } = require('../src/indexnow');

test('custom targets merge by origin and never enable Indexing API automatically', () => {
  const sites = getSites(['https://www.changfu.me/new#top', 'https://www.changfu.me/new', 'https://example.com/new?q=1']);
  assert.equal(sites.length, 3);
  assert.equal(sites[0].pages.filter((p) => p === '/new').length, 1);
  assert.deepEqual(sites[2].pages, ['/new?q=1']);
  assert.deepEqual(sites[2].indexingApiPaths, []);
  assert.throws(() => getSites(['javascript:alert(1)']));
  assert.throws(() => getSites(['https://user:pass@example.com']));
  assert.throws(() => getSites({}));
});

test('metadata parser uses HTML semantics without executing scripts', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const data = await readMetadata(page, `<html><head><title>Kitchen &amp; Ventilation</title>
      <meta content='A &quot;quote&quot; > test' name='DESCRIPTION'>
      <meta name='robots' content='noindex'><link href='/other' rel='canonical'>
      <script>throw new Error('must not execute')</script><script type='application/ld+json'>{bad}</script>
      </head><body><h1>Services</h1></body></html>`);
    assert.equal(data.title, 'Kitchen & Ventilation');
    assert.equal(data.description, 'A "quote" > test');
    assert.equal(data.invalidJsonLd, 1);
    const record = { ...data, url: 'https://example.com/', status: 200, html: true };
    record.issues = pageIssues(record);
    assert.ok(record.issues.some((issue) => issue.includes('noindex')));
    assert.ok(record.issues.some((issue) => issue.includes('canonical')));
    const pages = [record, { ...record, issues: [] }];
    addDuplicateIssues(pages);
    assert.ok(pages.every((entry) => entry.issues.some((issue) => issue.includes('重複'))));
    assert.deepEqual(pageIssues({ status: 200, html: false }), ['非 HTML 文件，未進行標題與摘要檢查']);
  } finally { await browser.close(); }
});

test('audit writes report and exposes failures without loading external resources', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'seo-audit-'));
  const previous = process.env.DRY_RUN;
  process.env.DRY_RUN = 'false';
  try {
    const result = await runAudit([{ name: 'fixture', baseUrl: 'https://example.com', pages: ['/', '/missing'] }], {
      outputDir,
      httpClient: { get: async (url) => ({ status: url.endsWith('/missing') ? 404 : 200, headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex' }, data: '<title>Test</title><script src="https://invalid.test/tracker"></script>' }) },
    });
    assert.equal(result, 1);
    const report = JSON.parse(await fs.readFile(path.join(outputDir, 'seo-audit.json'), 'utf8'));
    assert.equal(report.sites[0].pages.length, 2);
    assert.ok(report.sites[0].pages[0].issues.some((issue) => issue.includes('noindex')));
    assert.match(await fs.readFile(path.join(outputDir, 'seo-audit.md'), 'utf8'), /HTTP 404/);
  } finally {
    if (previous === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = previous;
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

test('IndexNow checks ownership before posting and batches 10000 URLs', async () => {
  const oldKey = process.env.INDEXNOW_API_KEY;
  const oldDry = process.env.DRY_RUN;
  process.env.INDEXNOW_API_KEY = 'test-key-123';
  process.env.DRY_RUN = 'false';
  try {
    const site = { name: 'fixture', baseUrl: 'https://example.com', pages: Array.from({ length: 10001 }, (_, n) => `/page/${n}`) };
    const batches = [];
    const client = {
      get: async () => ({ status: 200, data: 'test-key-123' }),
      post: async (_, payload) => { batches.push(payload.urlList.length); return { status: 202 }; },
    };
    assert.equal(await submitToIndexNow([site], client), 0);
    assert.deepEqual(batches, [10000, 1]);
    client.get = async () => ({ status: 200, data: 'wrong-key' });
    assert.equal(await submitToIndexNow([site], client), 1);
    assert.deepEqual(batches, [10000, 1]);
  } finally {
    if (oldKey === undefined) delete process.env.INDEXNOW_API_KEY; else process.env.INDEXNOW_API_KEY = oldKey;
    if (oldDry === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = oldDry;
  }
});

test('SERP truncation warnings fire on over-long titles and descriptions', () => {
  const base = { url: 'https://example.com/', status: 200, html: true, canonical: 'https://example.com/', h1: ['x'], ogTitle: 'a', ogDescription: 'b', ogImage: 'c', robots: '' };
  assert.equal(displayColumns('宜蘭 kitchen'), 12); // 2 full-width + 8 half-width
  assert.deepEqual(pageIssues({ ...base, title: '宜'.repeat(30), description: '描'.repeat(80) }), []);
  const issues = pageIssues({ ...base, title: '宜'.repeat(31), description: '描'.repeat(81) });
  assert.ok(issues.some((issue) => issue.startsWith('title 約 31 全形字')));
  assert.ok(issues.some((issue) => issue.startsWith('meta description 約 81 全形字')));
});

test('Search Console report compares 28-day windows and shortlists low-CTR rows', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gsc-'));
  const now = Date.parse('2026-09-20T00:00:00Z');
  const windows = buildWindows(now);
  assert.deepEqual(windows.current, { startDate: '2026-08-21', endDate: '2026-09-17' });
  assert.deepEqual(windows.previous, { startDate: '2026-07-24', endDate: '2026-08-20' });

  const row = (key, clicks, impressions, position) => ({ keys: [key], clicks, impressions, ctr: clicks / impressions, position });
  const asked = [];
  const client = {
    searchanalytics: {
      query: async ({ siteUrl, requestBody }) => {
        asked.push({ siteUrl, ...requestBody });
        const [dimension] = requestBody.dimensions;
        if (!dimension) return { data: { rows: [row('', requestBody.startDate === windows.current.startDate ? 10 : 5, 100, 12.5)] } };
        // 'low' is high-impression but under the 10% site CTR; 'good' beats it.
        return { data: { rows: [row(`${dimension}-low`, 2, 80, 20), row(`${dimension}-good`, 8, 20, 4)] } };
      },
    },
  };

  try {
    assert.equal(await runSearchConsole([{ name: 'fixture', baseUrl: 'https://example.com' }], { client, outputDir, now }), 0);
    assert.equal(asked[0].siteUrl, 'https://example.com/');
    assert.equal(asked[0].type, 'web');
    const report = JSON.parse(await fs.readFile(path.join(outputDir, 'gsc.json'), 'utf8'));
    assert.deepEqual(report.sites[0].queryOpportunities.map((entry) => entry.keys[0]), ['query-low']);
    const markdown = await fs.readFile(path.join(outputDir, 'gsc.md'), 'utf8');
    assert.match(markdown, /\| CTR \| 10\.00% \| 5\.00% \| \+5\.00pp \|/);
    assert.match(markdown, /\| 點擊 \| 10 \| 5 \| \+5 \|/);
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

test('Search Console failures are reported per site without aborting the run', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gsc-'));
  const client = { searchanalytics: { query: async () => { const error = new Error('User does not have sufficient permission'); error.code = 403; throw error; } } };
  try {
    assert.equal(await runSearchConsole([{ name: 'fixture', baseUrl: 'https://example.com' }], { client, outputDir }), 1);
    assert.match(await fs.readFile(path.join(outputDir, 'gsc.md'), 'utf8'), /查詢失敗：User does not have sufficient permission/);
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

test('URL inspection flags rich-result issues and stops after a property-level 403', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inspect-'));
  const inspected = [];
  const client = {
    urlInspection: {
      index: {
        inspect: async ({ requestBody }) => {
          inspected.push(requestBody.inspectionUrl);
          if (requestBody.siteUrl === 'https://denied.example.com/') { const error = new Error('You do not own this site'); error.code = 403; throw error; }
          return { data: { inspectionResult: {
            indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed', lastCrawlTime: '2026-09-19T01:41:20Z', userCanonical: requestBody.inspectionUrl, googleCanonical: 'https://example.com/' },
            richResultsResult: { detectedItems: [{ richResultType: 'Job Postings', items: [{ issues: [{ issueMessage: 'Missing field "validThrough"', severity: 'WARNING' }] }] }] },
          } } };
        },
      },
    },
  };
  const httpClient = { get: async () => ({ status: 404, data: '' }) }; // no sitemap, falls back to configured pages

  try {
    const failures = await runIndexInspection([
      { name: 'ok', baseUrl: 'https://example.com', pages: ['/', '/jobs'] },
      { name: 'denied', baseUrl: 'https://denied.example.com', pages: ['/', '/other'] },
    ], { client, httpClient, outputDir });

    assert.equal(failures, 1);
    assert.deepEqual(inspected, ['https://example.com/', 'https://example.com/jobs', 'https://denied.example.com/']); // 403 breaks before the second URL
    const markdown = await fs.readFile(path.join(outputDir, 'index-coverage.md'), 'utf8');
    assert.match(markdown, /已收錄 2 \/ 2 個網址/);
    assert.match(markdown, /Missing field "validThrough" \(WARNING\)/);
    assert.match(markdown, /### Google 選了不同的標準網址/);
    assert.match(markdown, /查詢失敗：You do not own this site/);
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

test('bot-protection challenges are reported but do not fail the audit', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'seo-audit-'));
  const previous = process.env.DRY_RUN;
  process.env.DRY_RUN = 'false';
  const challenge = '<html><head><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F"></meta></head></html>';

  assert.equal(isBotChallenge(202, challenge), true);
  assert.equal(isBotChallenge(403, challenge), true);
  assert.equal(isBotChallenge(403, '<html>Forbidden</html>'), false); // a real 403 still counts
  assert.equal(isBotChallenge(200, challenge), false);

  try {
    const result = await runAudit([{ name: 'fixture', baseUrl: 'https://example.com', pages: ['/', '/real-403'] }], {
      outputDir,
      httpClient: { get: async (url) => url.endsWith('/real-403')
        ? { status: 403, headers: { 'content-type': 'text/html' }, data: '<html>Forbidden</html>' }
        : { status: 202, headers: { 'content-type': 'text/html' }, data: challenge } },
    });
    assert.equal(result, 1); // only the genuine 403 counts as a failure
    const report = JSON.parse(await fs.readFile(path.join(outputDir, 'seo-audit.json'), 'utf8'));
    assert.equal(report.sites[0].pages[0].blocked, true);
    assert.ok(!report.sites[0].pages[1].blocked);
    assert.match(await fs.readFile(path.join(outputDir, 'seo-audit.md'), 'utf8'), /1 \/ 2 個網址被主機的機器人防護擋下/);
  } finally {
    if (previous === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = previous;
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});
