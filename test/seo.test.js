const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { getSites } = require('../src/config');
const { readMetadata, pageIssues, addDuplicateIssues, runAudit } = require('../src/audit');
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
