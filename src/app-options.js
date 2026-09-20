function parseBoolean(value) {
  if (typeof value !== 'string') {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function resolveModules(argv, env) {
  const allowed = ['audit', 'visit', 'search', 'indexing', 'indexnow'];
  const flags = argv.filter((arg) => arg.endsWith('-only'));
  if (flags.length > 1) throw new Error('Choose only one --*-only flag');
  for (const arg of argv) {
    if (arg !== '--dry-run' && !allowed.some((name) => arg === `--${name}-only`)) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (argv.includes('--audit-only')) return ['audit'];
  if (argv.includes('--visit-only')) return ['visit'];
  if (argv.includes('--search-only')) return ['search'];
  if (argv.includes('--indexing-only')) return ['indexing'];
  if (argv.includes('--indexnow-only')) return ['indexnow'];

  const envModules = env.RUN_MODULES;
  if (envModules) {
    const modules = envModules
      .split(',')
      .map((moduleName) => moduleName.trim())
      .filter(Boolean);
    if (!modules.length || modules.some((name) => !allowed.includes(name))) {
      throw new Error(`RUN_MODULES must use: ${allowed.join(',')}`);
    }
    return [...new Set(modules)];
  }

  return ['audit'];
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
