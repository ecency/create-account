'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parseArgs, loadCreatorConfig, runLoop } = require('../main')

test('parseArgs: long running by default, --once for a single pass', () => {
  assert.deepEqual(parseArgs([]), { once: false })
  assert.deepEqual(parseArgs(['--once']), { once: true })
  assert.throws(() => parseArgs(['--onse']), /--onse/)
  assert.throws(() => parseArgs(['once']), /once/)
})

test('loadCreatorConfig: missing file is fine, a present one is read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recover-cfg-'))
  try {
    assert.equal(loadCreatorConfig(dir), null)
    fs.writeFileSync(path.join(dir, 'config.js'), "module.exports = { creators: ['x-one'], privateKeys: ['5Kx'] }\n")
    assert.deepEqual(loadCreatorConfig(dir), { creators: ['x-one'], privateKeys: ['5Kx'] })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('loadCreatorConfig: a broken config.js is an error, not "no config"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recover-cfg-'))
  try {
    fs.writeFileSync(path.join(dir, 'config.js'), "require('./does-not-exist')\n")
    assert.throws(() => loadCreatorConfig(dir), /does-not-exist/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runLoop --once polls exactly once and never sleeps', async () => {
  let polls = 0
  let sleeps = 0
  await runLoop({
    once: true,
    pollSeconds: 15,
    pollOnce: async () => { polls++ },
    sleep: async () => { sleeps++ },
    shouldStop: () => polls >= 5, // backstop so a broken --once fails instead of hanging
  })
  assert.equal(polls, 1)
  assert.equal(sleeps, 0)
})

test('runLoop keeps polling until asked to stop', async () => {
  let polls = 0
  const sleeps = []
  await runLoop({
    once: false,
    pollSeconds: 7,
    pollOnce: async () => { polls++ },
    sleep: async (ms) => { sleeps.push(ms) },
    shouldStop: () => polls >= 3,
  })
  assert.equal(polls, 3)
  assert.deepEqual(sleeps, [7000, 7000])
})
