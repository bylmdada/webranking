const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractLocs,
  resolveIndexingApiUrls,
  resolveSubmissionTargets,
} = require('../src/url-resolver');

test('extractLocs reads every loc entry from sitemap XML', () => {
  const xml = `
    <urlset>
      <url><loc>https://example.com/</loc></url>
      <url><loc>https://example.com/about</loc></url>
    </urlset>
  `;

  assert.deepEqual(extractLocs(xml), [
    'https://example.com/',
    'https://example.com/about',
  ]);
});

test('resolveSubmissionTargets prefers sitemap URLs and filters foreign hosts', async () => {
  const site = {
    baseUrl: 'https://example.com',
    sitemapUrl: 'https://example.com/sitemap.xml',
    pages: ['/fallback'],
  };
  const httpClient = {
    async get() {
      return {
        data: `
          <urlset>
            <url><loc>https://example.com/</loc></url>
            <url><loc>https://example.com/contact</loc></url>
            <url><loc>https://other.example.net/ignore-me</loc></url>
          </urlset>
        `,
      };
    },
  };

  const result = await resolveSubmissionTargets(site, httpClient);

  assert.equal(result.source, 'sitemap');
  assert.deepEqual(result.urls, [
    'https://example.com/',
    'https://example.com/contact',
    'https://example.com/fallback',
  ]);
});

test('resolveSubmissionTargets falls back to curated pages when sitemap fetch fails', async () => {
  const site = {
    baseUrl: 'https://example.com',
    sitemapUrl: 'https://example.com/sitemap.xml',
    pages: ['/', '/about'],
  };
  const httpClient = {
    async get() {
      throw new Error('network error');
    },
  };

  const result = await resolveSubmissionTargets(site, httpClient);

  assert.equal(result.source, 'pages');
  assert.deepEqual(result.urls, [
    'https://example.com/',
    'https://example.com/about',
  ]);
});

test('resolveIndexingApiUrls only uses explicit eligible paths', () => {
  const site = {
    baseUrl: 'https://example.com',
    indexingApiPaths: ['/jobs/123', 'https://example.com/live/abc'],
  };

  assert.deepEqual(resolveIndexingApiUrls(site), [
    'https://example.com/jobs/123',
    'https://example.com/live/abc',
  ]);
});

test('URL normalization rejects foreign origins and credentials, strips fragments', () => {
  const { toAbsoluteUrl, resolveDeclaredUrls } = require('../src/url-resolver');
  for (const value of ['https://evil.test/', 'javascript:alert(1)', 'https://user:pass@example.com/', '//example.com:444/']) {
    assert.throws(() => toAbsoluteUrl('https://example.com', value));
  }
  assert.deepEqual(resolveDeclaredUrls({ baseUrl: 'https://example.com', pages: ['/#top', '/'] }), ['https://example.com/']);
  assert.deepEqual(extractLocs('<loc>https://example.com/?a=1&amp;b=&#50;</loc><loc><![CDATA[https://example.com/?a=1&b=2]]></loc>'), ['https://example.com/?a=1&b=2', 'https://example.com/?a=1&b=2']);
});

test('nested sitemaps handle cycles without duplicate fetches and reject foreign fetches', async () => {
  const { fetchSitemapUrls } = require('../src/url-resolver');
  const seen = [];
  const client = { async get(url) {
    seen.push(url);
    return { data: url.endsWith('/child.xml') ? '<urlset><url><loc>https://example.com/a</loc></url></urlset>' : '<sitemapindex><sitemap><loc>https://example.com/root.xml</loc></sitemap><sitemap><loc>https://example.com/child.xml</loc></sitemap></sitemapindex>' };
  } };
  assert.deepEqual(await fetchSitemapUrls('https://example.com/root.xml', client), ['https://example.com/a']);
  assert.equal(seen.length, 2);
  await assert.rejects(() => fetchSitemapUrls('https://example.com/root.xml', { get: async () => ({ data: '<sitemapindex><loc>http://localhost/private.xml</loc></sitemapindex>' }) }), /origin/);
});
