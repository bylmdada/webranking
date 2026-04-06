require('dotenv').config();

const { sites } = require('./src/config');
const { getAppOptions } = require('./src/app-options');
const { runVisits } = require('./src/visit');
const { runSearches } = require('./src/search');
const { submitToIndexingAPI } = require('./src/indexing-api');
const { submitToIndexNow } = require('./src/indexnow');

async function main() {
  const { modules, dryRun } = getAppOptions();
  const startTime = Date.now();

  console.log('='.repeat(60));
  console.log(`Google Ranking Automation - ${new Date().toISOString()}`);
  console.log(`Modules: ${modules.join(', ')}`);
  console.log(`Sites: ${sites.map((s) => s.name).join(', ')}`);
  console.log(`Dry run: ${dryRun ? 'yes' : 'no'}`);
  console.log('='.repeat(60));

  if (modules.includes('visit')) {
    console.log('\n--- Direct Visit Module ---');
    await runVisits(sites);
  }

  if (modules.includes('search')) {
    console.log('\n--- Google Search Module ---');
    await runSearches(sites);
  }

  if (modules.includes('indexing')) {
    console.log('\n--- Google Indexing API Module ---');
    await submitToIndexingAPI(sites);
  }

  if (modules.includes('indexnow')) {
    console.log('\n--- IndexNow Module ---');
    await submitToIndexNow(sites);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(60));
  console.log(`Done! Total time: ${elapsed}s`);
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
