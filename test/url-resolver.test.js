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