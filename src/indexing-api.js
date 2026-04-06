const { google } = require('googleapis');
const { isDryRun } = require('./app-options');
const { resolveIndexingApiUrls } = require('./url-resolver');
const { log } = require('./utils');

async function submitToIndexingAPI(sites) {
  const dryRun = isDryRun();
  const keyEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!dryRun && !keyEnv) {
    log('indexing-api', 'GOOGLE_SERVICE_ACCOUNT_KEY not set, skipping Indexing API');
    return;
  }

  log('indexing-api', `Starting Google Indexing API submissions${dryRun ? ' (dry-run)' : ''}`);

  if (dryRun) {
    for (const site of sites) {
      const urls = resolveIndexingApiUrls(site);
      if (urls.length === 0) {
        log('indexing-api', `${site.name}: dry-run skip, no explicit indexingApiPaths configured`);
        continue;
      }

      log('indexing-api', `${site.name}: dry-run would submit ${urls.length} URLs`);
      for (const url of urls) {
        log('indexing-api', `Dry run submit: ${url}`);
      }
    }

    log('indexing-api', 'Dry-run completed');
    return;
  }

  let credentials;
  try {
    // Support both base64-encoded and raw JSON
    try {
      credentials = JSON.parse(Buffer.from(keyEnv, 'base64').toString('utf-8'));
    } catch {
      credentials = JSON.parse(keyEnv);
    }
  } catch (error) {
    log('indexing-api', `Failed to parse service account key: ${error.message}`);
    return;
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/indexing'],
  });

  const indexing = google.indexing({ version: 'v3', auth });

  let submitted = 0;
  let errors = 0;

  for (const site of sites) {
    const urls = resolveIndexingApiUrls(site);
    if (urls.length === 0) {
      log('indexing-api', `${site.name}: no explicit indexingApiPaths configured, skipping`);
      continue;
    }

    for (const url of urls) {

      try {
        await indexing.urlNotifications.publish({
          requestBody: {
            url,
            type: 'URL_UPDATED',
          },
        });
        submitted++;
        log('indexing-api', `Submitted: ${url}`);
      } catch (error) {
        errors++;
        log('indexing-api', `Failed to submit ${url}: ${error.message}`);
      }

      // Small delay between API calls
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  log('indexing-api', `Indexing API done: ${submitted} submitted, ${errors} errors`);
}

module.exports = { submitToIndexingAPI };
