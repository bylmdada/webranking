require('dotenv').config();

const { getSites } = require('./src/config');
const { runAudit } = require('./src/audit');
const { runSearchConsole } = require('./src/gsc');
const { runIndexInspection } = require('./src/inspect');
const { getAppOptions } = require('./src/app-options');
const { runVisits } = require('./src/visit');
const { runSearches } = require('./src/search');
const { submitToIndexingAPI } = require('./src/indexing-api');
const { submitToIndexNow } = require('./src/indexnow');

async function main() {
  const { modules, dryRun } = getAppOptions();
  const sites = getSites();
  const startTime = Date.now();

  console.log('='.repeat(60));
  console.log(`Google Ranking Automation - ${new Date().toISOString()}`);
  console.log(`Modules: ${modules.join(', ')}`);
  console.log(`Sites: ${sites.map((s) => s.name).join(', ')}`);
  console.log(`Dry run: ${dryRun ? 'yes' : 'no'}`);
  console.log('='.repeat(60));

  let failures = 0;

  if (modules.includes('audit')) failures += await runAudit(sites);

  if (modules.includes('gsc')) {
    console.log('\n--- Search Console Performance Module ---');
    failures += await runSearchConsole(sites);
  }

  if (modules.includes('inspect')) {
    console.log('\n--- URL Inspection Module ---');
    failures += await runIndexInspection(sites);
  }

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
    failures += await submitToIndexingAPI(sites);
  }

  if (modules.includes('indexnow')) {
    console.log('\n--- IndexNow Module ---');
    failures += await submitToIndexNow(sites);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(60));
  console.log(`Done! Total time: ${elapsed}s`);
  if (failures > 0) {
    console.log(`Completed with ${failures} failure(s)`);
    process.exitCode = 1;
  }
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
