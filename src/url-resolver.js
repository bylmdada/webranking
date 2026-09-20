const axios = require('axios');

function dedupe(urls) {
  return [...new Set(urls)];
}

function toAbsoluteUrl(baseUrl, value) {
  const url = new URL(value, baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      url.origin !== new URL(baseUrl).origin) {
    throw new Error('URL must be HTTP(S), without credentials, and on the site origin');
  }
  url.hash = '';
  return url.toString();
}

function extractLocs(xml) {
  // ponytail: standard unprefixed sitemap locs; use an XML parser if other schemas are needed.
  const matches = xml.matchAll(/<loc\b[^>]*>(.*?)<\/loc\s*>/gsi);
  return [...matches].map((match) => {
    const value = match[1].trim();
    if (value.startsWith('<![CDATA[') && value.endsWith(']]>')) return value.slice(9, -3).trim();
    return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity, key) => {
      if (key.startsWith('#')) {
        const number = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
        return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
      }
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[key.toLowerCase()];
    });
  }).filter(Boolean);
}

async function fetchSitemapUrls(sitemapUrl, httpClient = axios, visited = new Set()) {
  if (!sitemapUrl || visited.has(sitemapUrl)) {
    return [];
  }

  visited.add(sitemapUrl);
  if (visited.size > 50) throw new Error('Sitemap limit exceeded (50 documents)');

  const response = await httpClient.get(sitemapUrl, {
    timeout: 15000,
    responseType: 'text',
    maxContentLength: 5 * 1024 * 1024,
    maxRedirects: 0,
  });

  const xml = typeof response.data === 'string' ? response.data : String(response.data);
  const locs = extractLocs(xml);

  if (xml.includes('<sitemapindex')) {
    const urls = [];
    for (const loc of locs) {
      urls.push(...await fetchSitemapUrls(toAbsoluteUrl(sitemapUrl, loc), httpClient, visited));
    }
    return dedupe(urls);
  }

  if (!/<urlset\b/i.test(xml)) throw new Error('Response is not a sitemap urlset');
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
  return dedupe(urls.flatMap((value) => {
    try {
      return [toAbsoluteUrl(baseUrl, value)];
    } catch {
      return [];
    }
  }));
}

async function resolveSubmissionTargets(site, httpClient = axios) {
  const declared = resolveDeclaredUrls(site, 'pages');
  let warning;
  if (site.sitemapUrl) {
    try {
      const sitemapUrls = await fetchSitemapUrls(site.sitemapUrl, httpClient);
      const sameHostUrls = filterUrlsToSiteHost(sitemapUrls, site.baseUrl);
      if (sameHostUrls.length > 0) {
        return {
          urls: dedupe([...sameHostUrls, ...declared]),
          source: 'sitemap',
        };
      }
      warning = 'Sitemap contains no usable site URLs';
    } catch (error) {
      warning = `Sitemap unavailable: ${error.code || error.message}`;
    }
  }

  return {
    urls: declared,
    source: 'pages',
    warning,
  };
}

module.exports = {
  toAbsoluteUrl,
  extractLocs,
  fetchSitemapUrls,
  resolveDeclaredUrls,
  resolveIndexingApiUrls,
  resolveSubmissionTargets,
};
