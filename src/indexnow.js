const axios = require('axios');
const { isDryRun } = require('./app-options');
const { resolveDeclaredUrls, resolveSubmissionTargets } = require('./url-resolver');
const { log } = require('./utils');

async function submitToIndexNow(sites) {
  const dryRun = isDryRun();
  const apiKey = process.env.INDEXNOW_API_KEY;
  if (!dryRun && !apiKey) {
    log('indexnow', 'INDEXNOW_API_KEY not set, skipping IndexNow');
    return;
  }

  log('indexnow', `Starting IndexNow submissions${dryRun ? ' (dry-run)' : ''}`);

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

    const { urls, source } = await resolveSubmissionTargets(site, axios);
    if (urls.length === 0) {
      log('indexnow', `${site.name}: no URLs resolved, skipping`);
      continue;
    }

    const payload = {
      host: new URL(site.baseUrl).hostname,
      key: apiKey,
      keyLocation: `${site.baseUrl}/${apiKey}.txt`,
      urlList: urls,
    };

    try {
      const response = await axios.post('https://api.indexnow.org/IndexNow', payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      });
      log('indexnow', `${site.name}: submitted ${urls.length} URLs from ${source} (status ${response.status})`);
    } catch (error) {
      const status = error.response?.status || 'N/A';
      log('indexnow', `${site.name}: failed (status ${status}): ${error.message}`);
    }
  }

  log('indexnow', 'IndexNow submissions completed');
}

module.exports = { submitToIndexNow };
