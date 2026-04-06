const axios = require('axios');

function dedupe(urls) {
  return [...new Set(urls)];
}

function toAbsoluteUrl(baseUrl, value) {
  return new URL(value, baseUrl).toString();
}

function extractLocs(xml) {
  const matches = xml.matchAll(/<loc>(.*?)<\/loc>/gsi);
  return [...matches].map((match) => match[1].trim()).filter(Boolean);
}

async function fetchSitemapUrls(sitemapUrl, httpClient = axios, visited = new Set()) {
  if (!sitemapUrl || visited.has(sitemapUrl)) {
    return [];
  }

  visited.add(sitemapUrl);

  const response = await httpClient.get(sitemapUrl, {
    timeout: 15000,
    responseType: 'text',
  });

  const xml = typeof response.data === 'string' ? response.data : String(response.data);
  const locs = extractLocs(xml);

  if (xml.includes('<sitemapindex')) {
    const nestedResults = await Promise.all(locs.map((loc) => fetchSitemapUrls(loc, httpClient, visited)));
    return dedupe(nestedResults.flat());
  }

  return dedupe(locs);
}

function resolveDeclaredUrls(site, pathsKey = 'pages') {
  const values = Array.isArray(site[pathsKey]) ? site[pathsKey] : [];
  return dedupe(values.map((value) => toAbsoluteUrl(site.baseUrl, value)));
}

function resolveIndexingApiUrls(site) {
  return resolveDeclaredUrls(site, 'indexingApiPaths');
}

function filterUrlsToSiteHost(urls, baseUrl) {
  const targetHost = new URL(baseUrl).hostname;
  return urls.filter((value) => {
    try {
      return new URL(value).hostname === targetHost;
    } catch {
      return false;
    }
  });
}

async function resolveSubmissionTargets(site, httpClient = axios) {
  if (site.sitemapUrl) {
    try {
      const sitemapUrls = await fetchSitemapUrls(site.sitemapUrl, httpClient);
      const sameHostUrls = filterUrlsToSiteHost(sitemapUrls, site.baseUrl);
      if (sameHostUrls.length > 0) {
        return {
          urls: sameHostUrls,
          source: 'sitemap',
        };
      }
    } catch {
      // Fall back to the curated page list below.
    }
  }

  return {
    urls: resolveDeclaredUrls(site, 'pages'),
    source: 'pages',
  };
}

module.exports = {
  extractLocs,
  fetchSitemapUrls,
  resolveDeclaredUrls,
  resolveIndexingApiUrls,
  resolveSubmissionTargets,
};