function parseBoolean(value) {
  if (typeof value !== 'string') {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function resolveModules(argv, env) {
  if (argv.includes('--visit-only')) return ['visit'];
  if (argv.includes('--search-only')) return ['search'];
  if (argv.includes('--indexing-only')) return ['indexing'];
  if (argv.includes('--indexnow-only')) return ['indexnow'];

  const envModules = env.RUN_MODULES;
  if (envModules) {
    return envModules
      .split(',')
      .map((moduleName) => moduleName.trim())
      .filter(Boolean);
  }

  return ['visit', 'search', 'indexing', 'indexnow'];
}

function getAppOptions(argv = process.argv.slice(2), env = process.env) {
  return {
    modules: resolveModules(argv, env),
    dryRun: argv.includes('--dry-run') || parseBoolean(env.DRY_RUN),
  };
}

function isDryRun(argv = process.argv.slice(2), env = process.env) {
  return getAppOptions(argv, env).dryRun;
}

module.exports = {
  getAppOptions,
  isDryRun,
  parseBoolean,
};