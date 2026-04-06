const test = require('node:test');
const assert = require('node:assert/strict');

const { getAppOptions, parseBoolean } = require('../src/app-options');

test('parseBoolean recognizes common truthy flags', () => {
  assert.equal(parseBoolean('true'), true);
  assert.equal(parseBoolean('1'), true);
  assert.equal(parseBoolean('YES'), true);
  assert.equal(parseBoolean('on'), true);
  assert.equal(parseBoolean('false'), false);
  assert.equal(parseBoolean(undefined), false);
});

test('getAppOptions enables dry-run from CLI flag', () => {
  const result = getAppOptions(['--dry-run'], {});

  assert.equal(result.dryRun, true);
  assert.deepEqual(result.modules, ['visit', 'search', 'indexing', 'indexnow']);
});

test('getAppOptions reads env module selection and dry-run flag', () => {
  const result = getAppOptions([], {
    RUN_MODULES: 'visit,indexnow',
    DRY_RUN: 'true',
  });

  assert.equal(result.dryRun, true);
  assert.deepEqual(result.modules, ['visit', 'indexnow']);
});

test('getAppOptions keeps single-module CLI shortcuts', () => {
  const result = getAppOptions(['--search-only'], {
    RUN_MODULES: 'visit,indexnow',
    DRY_RUN: 'false',
  });

  assert.equal(result.dryRun, false);
  assert.deepEqual(result.modules, ['search']);
});