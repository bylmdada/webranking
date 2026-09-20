const axios = require('axios');
const { isDryRun } = require('./app-options');
const { resolveDeclaredUrls, resolveSubmissionTargets } = require('./url-resolver');
const { log } = require('./utils');

async function submitToIndexNow(sites, httpClient = axios) {
  const dryRun = isDryRun();
  const apiKey = process.env.INDEXNOW_API_KEY;
  if (!dryRun && !apiKey) {
    log('indexnow', 'INDEXNOW_API_KEY not set, skipping IndexNow');
    return 0;
  }
  if (!dryRun && !/^[a-zA-Z0-9-]{8,128}$/.test(apiKey)) {
    log('indexnow', 'Invalid INDEXNOW_API_KEY format');
    return 1;
  }

  log('indexnow', `Starting IndexNow submissions${dryRun ? ' (dry-run)' : ''}`);

  let failures = 0;

  for (const site of sites) {
    if (dryRun) {
      const urls = resolveDeclaredUrls(site, 'pages');
      if (urls.length === 0) {
        log('indexnow', `${site.name}: dry-run no declared pages, skipping`);
        continue;
      }

      log('indexnow', `${site.name}: dry-run would submit ${urls.length} URLs from pages`);
      continue;
    }

    const { urls, source, warning } = await resolveSubmissionTargets(site, httpClient);
    if (warning) log('indexnow', `${site.name}: ${warning}`);
    if (urls.length === 0) {
      log('indexnow', `${site.name}: no URLs resolved, skipping`);
      continue;
    }

    const payload = {
      host: new URL(site.baseUrl).hostname,
      key: apiKey,
      keyLocation: new URL(`/${apiKey}.txt`, site.baseUrl).href,
      urlList: urls,
    };

    try {
      const keyResponse = await httpClient.get(payload.keyLocation, {
        responseType: 'text', timeout: 15000, maxRedirects: 0, maxContentLength: 1024,
      });
      if (keyResponse.status !== 200 || String(keyResponse.data).trim() !== apiKey) {
        throw new Error('IndexNow ownership file does not match the configured key');
      }
      for (let offset = 0; offset < urls.length; offset += 10000) {
        const urlList = urls.slice(offset, offset + 10000);
        const response = await httpClient.post('https://api.indexnow.org/IndexNow', { ...payload, urlList }, {
          headers: { 'Content-Type': 'application/json' }, timeout: 15000,
        });
        if (![200, 202].includes(response.status)) throw new Error(`Unexpected IndexNow status ${response.status}`);
        log('indexnow', `${site.name}: received ${urlList.length} URLs from ${source} (status ${response.status}${response.status === 202 ? ', key validation pending' : ''}); indexing is not guaranteed`);
      }
    } catch (error) {
      failures++;
      const status = error.response?.status || 'N/A';
      log('indexnow', `${site.name}: failed (status ${status}): ${error.message}`);
    }
  }

  log('indexnow', 'IndexNow submissions completed');
  return failures;
}

module.exports = { submitToIndexNow };
