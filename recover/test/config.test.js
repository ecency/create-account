'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadConfig, DEFAULT_ONBOARD_URL } = require('../config')

const base = {
  ONBOARD_URL: 'http://127.0.0.1:8000/',
  RECOVERY_WORKER_TOKEN: 'tok-secret-value',
  RECOVERY_ACCOUNT: 'ecency',
  RECOVERY_ACTIVE_WIF: '5Kwif-secret-value',
  HIVE_NODES: 'https://a.example, https://b.example',
}

const creators = (names, keys) => ({ creators: names, privateKeys: keys })

test('defaults and parsing', () => {
  const c = loadConfig(base)
  assert.equal(c.onboardUrl, 'http://127.0.0.1:8000')
  assert.equal(c.recoveryAccount, 'ecency')
  assert.deepEqual(c.hiveNodes, ['https://a.example', 'https://b.example'])
  assert.equal(c.pollSeconds, 15)
  assert.equal(c.maxPerHour, 10)
  assert.equal(c.dryRun, false)
  assert.equal(c.workerToken, 'tok-secret-value')
  assert.equal(c.activeWif, '5Kwif-secret-value')
  assert.equal(c.keySource, 'env')
})

test('ONBOARD_URL defaults to the public gateway', () => {
  const { ONBOARD_URL, ...rest } = base
  assert.equal(DEFAULT_ONBOARD_URL, 'https://api.ecency.com')
  assert.equal(loadConfig(rest).onboardUrl, 'https://api.ecency.com')
})

test('CREATOR_TOKEN is no longer accepted in place of RECOVERY_WORKER_TOKEN', () => {
  const { RECOVERY_WORKER_TOKEN, ...rest } = base
  assert.throws(() => loadConfig({ ...rest, CREATOR_TOKEN: 'x' }), /RECOVERY_WORKER_TOKEN/)
})

test('missing WIF refuses to start unless DRY_RUN=1', () => {
  const { RECOVERY_ACTIVE_WIF, ...noWif } = base
  assert.throws(() => loadConfig(noWif), /RECOVERY_ACTIVE_WIF/)
  const c = loadConfig({ ...noWif, DRY_RUN: '1' })
  assert.equal(c.dryRun, true)
  assert.equal(c.activeWif, null)
  assert.equal(c.keySource, null)
})

test('the active key can come from the creator config', () => {
  const { RECOVERY_ACTIVE_WIF, ...noWif } = base
  const cfg = creators(['good-karma', 'ecency'], ['5Kother-secret', '5Kcfg-secret-value'])
  const c = loadConfig(noWif, cfg)
  assert.equal(c.activeWif, '5Kcfg-secret-value')
  assert.equal(c.keySource, 'config.js')
  // the env key wins
  const e = loadConfig(base, cfg)
  assert.equal(e.activeWif, '5Kwif-secret-value')
  assert.equal(e.keySource, 'env')
})

test('a creator config without a key for the account is not used', () => {
  const { RECOVERY_ACTIVE_WIF, ...noWif } = base
  for (const cfg of [
    creators(['good-karma'], ['5Kother-secret']),
    creators(['ecency'], []),
    creators(['ecency'], ['  ']),
    creators(['ecency'], [42]),
    creators('ecency', '5Kx'),
    null,
  ]) {
    assert.throws(() => loadConfig(noWif, cfg), /RECOVERY_ACTIVE_WIF/, JSON.stringify(cfg))
  }
})

test('RECOVERY_ACCOUNT falls back to the only creator in the creator config', () => {
  const { RECOVERY_ACCOUNT, RECOVERY_ACTIVE_WIF, ...rest } = base
  const c = loadConfig(rest, creators(['appreciator'], ['5Kpartner-secret']))
  assert.equal(c.recoveryAccount, 'appreciator')
  assert.equal(c.activeWif, '5Kpartner-secret')
  // several creators, or none: it must be named
  const named = /RECOVERY_ACCOUNT is required/
  assert.throws(() => loadConfig({ ...rest, DRY_RUN: '1' }, creators(['a-one', 'a-two'], ['5Ka', '5Kb'])), named)
  assert.throws(() => loadConfig({ ...rest, DRY_RUN: '1' }), named)
  assert.throws(() => loadConfig({ ...rest, DRY_RUN: '1', RECOVERY_ACCOUNT: 'Bad_Name' }), named)
  assert.equal(loadConfig({ ...rest, RECOVERY_ACCOUNT: ' appreciator ', DRY_RUN: '1' }).recoveryAccount, 'appreciator')
})

test('ONBOARD_URL: http only for loopback and private addresses', () => {
  for (const ok of ['http://127.0.0.1:8000', 'http://127.9.9.9', 'http://10.1.2.3', 'http://172.16.0.1',
    'http://172.31.255.255:81/', 'http://192.168.1.1', 'http://[::1]:8080', 'http://[fd12:3456::1]', 'http://[fc00::1]',
    'https://api.ecency.com', 'https://example.org/']) {
    assert.doesNotThrow(() => loadConfig({ ...base, ONBOARD_URL: ok }), ok)
  }
  for (const bad of ['http://api.ecency.com', 'http://example.org', 'http://localhost', 'http://11.0.0.1',
    'http://172.32.0.1', 'http://172.15.0.1', 'http://192.169.1.1', 'http://8.8.8.8', 'http://[fe80::1]',
    'http://[2001:db8::1]', 'http://127.0.0.1.example.com', 'http://user:pw@127.0.0.1', 'ftp://127.0.0.1', 'https://']) {
    assert.throws(() => loadConfig({ ...base, ONBOARD_URL: bad }), /ONBOARD_URL/, bad)
  }
})

test('POLL_SECONDS is capped at an hour', () => {
  assert.equal(loadConfig({ ...base, POLL_SECONDS: '3600' }).pollSeconds, 3600)
  assert.throws(() => loadConfig({ ...base, POLL_SECONDS: '3601' }), /POLL_SECONDS/)
})

test('required values and numbers are validated', () => {
  assert.throws(() => loadConfig({ ...base, ONBOARD_URL: 'ftp://x' }), /ONBOARD_URL/)
  assert.throws(() => loadConfig({ ...base, RECOVERY_WORKER_TOKEN: '' }), /RECOVERY_WORKER_TOKEN/)
  assert.throws(() => loadConfig({ ...base, HIVE_NODES: ' , ' }), /HIVE_NODES/)
  assert.throws(() => loadConfig({ ...base, POLL_SECONDS: '0' }), /POLL_SECONDS/)
  assert.throws(() => loadConfig({ ...base, MAX_PER_HOUR: 'ten' }), /MAX_PER_HOUR/)
  assert.throws(() => loadConfig({ ...base, DRY_RUN: 'yes' }), /DRY_RUN/)
})

test('config errors never echo secret values', () => {
  const { RECOVERY_ACCOUNT, ...rest } = base
  try {
    loadConfig({ ...rest, POLL_SECONDS: 'x', ONBOARD_URL: 'ftp://x' }, creators(['a-one', 'a-two'], ['5Kcfg-a', '5Kcfg-b']))
    assert.fail('expected throw')
  } catch (e) {
    for (const s of ['tok-secret-value', '5Kwif-secret-value', '5Kcfg-a', '5Kcfg-b']) assert.ok(!e.message.includes(s), s)
  }
})
