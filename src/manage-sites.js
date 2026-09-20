const fs = require('node:fs');
const path = require('node:path');
const { getSites } = require('./config');
const { toAbsoluteUrl } = require('./url-resolver');

const file = path.join(__dirname, '..', 'targets.json');
try {
  const [command = 'list', ...values] = process.argv.slice(2);
  const targets = JSON.parse(fs.readFileSync(file, 'utf8'));
  getSites(targets);
  if (command === 'list') {
    for (const site of getSites(targets)) console.log(`${site.baseUrl}\n${site.pages.map((p) => `  ${p}`).join('\n')}`);
  } else if (command === 'add' && values.length) {
    const urls = values.map((value) => toAbsoluteUrl(new URL(value).origin, value));
    const updated = [...new Set([...targets, ...urls])];
    getSites(updated);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(updated, null, 2) + '\n');
    fs.renameSync(`${file}.tmp`, file);
    console.log(`Added ${updated.length - targets.length} URL(s) to targets.json. Run npm run audit to check them.`);
  } else {
    throw new Error('Usage: npm run sites -- list | add https://your-site.com/page [...]');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
