'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { processRow, pollOnce } = require('../worker')
const { createHourlyCap, buildRequestOp } = require('../rules')
const { KEYS, DAY, MIN, authority, historyEntry, row, chainState, at } = require('./fixtures')

function deps(over = {}) {
  const calls = { broadcast: [], put: [], getState: [] }
  const d = {
    calls,
    config: { recoveryAccount: 'ecency', marginMs: 10 * MIN, dryRun: false },
    chain: { getState: async (u) => { calls.getState.push(u); return chainState() } },
    signer: { broadcast: async (op) => { calls.broadcast.push(op); return { id: 'abc123' } } },
    onboard: { putResult: async (id, body) => { calls.put.push([id, body]) } },
    cap: createHourlyCap(10, () => 0),
    log: { info() {}, warn() {}, error() {} },
    broadcastFailures: new Map(),
    chainFailures: new Map(),
    ...over,
  }
  return d
}

test('broadcasts and reports requested with tx id', async () => {
  const d = deps()
  const out = await processRow(row(), d)
  assert.equal(out, 'requested')
  assert.deepEqual(d.calls.broadcast, [buildRequestOp('ecency', 'alice', KEYS.newOwner)])
  assert.deepEqual(d.calls.put, [[row().request_id, { status: 'requested', tx_id: 'abc123' }]])
  assert.equal(d.cap.count(), 1)
})

test('already requested on chain: reports requested without broadcasting', async () => {
  const d = deps({
    chain: {
      getState: async () => chainState({
        pendingRequests: [{ account_to_recover: 'alice', new_owner_authority: authority([KEYS.newOwner]), expires: at(DAY) }],
      }),
    },
  })
  const out = await processRow(row(), d)
  assert.equal(out, 'already_requested')
  assert.equal(d.calls.broadcast.length, 0)
  assert.deepEqual(d.calls.put, [[row().request_id, { status: 'requested' }]])
})

function recordingLog() {
  const lines = []
  const rec = (level) => (msg, f = {}) => lines.push({ level, msg, ...f })
  return { lines, info: rec('info'), warn: rec('warn'), error: rec('error') }
}

test('a row for another recovery account is skipped: no write, no broadcast, an error log', async () => {
  const log = recordingLog()
  const d = deps({ log, config: { recoveryAccount: 'ecency', marginMs: 10 * MIN, dryRun: false, workerToken: 'tok-secret' } })
  const r = row({ recovery_account: 'appreciator' })
  const out = await processRow(r, d)
  assert.equal(out, 'skipped')
  assert.equal(d.calls.broadcast.length, 0)
  assert.deepEqual(d.calls.put, [])
  assert.deepEqual(d.calls.getState, [])
  const err = log.lines.find((l) => l.level === 'error')
  assert.equal(err.row_recovery_account, 'appreciator')
  assert.equal(err.configured_recovery_account, 'ecency')
  assert.ok(!JSON.stringify(log.lines).includes('tok-secret'))
})

test('pollOnce keeps going after a mismatched row', async () => {
  const d = deps()
  d.onboard.getPending = async () => [row({ recovery_account: 'appreciator', request_id: 'r-1' }), row({ request_id: 'r-2' })]
  d.shouldStop = () => false
  assert.equal(await pollOnce(d), 2)
  assert.deepEqual(d.calls.put.map((p) => p[0]), ['r-2'])
})

test('final broadcast failure: a matching request found on re-read is reported requested', async () => {
  let reads = 0
  const landed = chainState({
    pendingRequests: [{ account_to_recover: 'alice', new_owner_authority: authority([KEYS.newOwner]), expires: at(DAY) }],
  })
  const d = deps({
    chain: { getState: async () => (++reads > 3 ? landed : chainState()) },
    signer: { broadcast: async () => { throw new Error('timeout') } },
  })
  assert.equal(await processRow(row(), d), 'error')
  assert.equal(await processRow(row(), d), 'error')
  assert.equal(await processRow(row(), d), 'requested')
  assert.equal(reads, 4)
  assert.deepEqual(d.calls.put, [[row().request_id, { status: 'requested' }]])
})

test('final broadcast failure: no match or a failed re-read still fails the row', async () => {
  for (const reread of [async () => chainState(), async () => { throw new Error('node down') }]) {
    let reads = 0
    const d = deps({
      chain: { getState: async () => (++reads > 3 ? reread() : chainState()) },
      signer: { broadcast: async () => { throw new Error('timeout') } },
    })
    await processRow(row(), d)
    await processRow(row(), d)
    assert.equal(await processRow(row(), d), 'failed')
    assert.deepEqual(d.calls.put, [[row().request_id, { status: 'failed', error: 'broadcast_error' }]])
  }
})

test('malformed chain data that makes the rules throw counts as a chain read failure', async () => {
  const bad = chainState({
    ownerHistory: [{ id: 1, account: 'alice', previous_owner_authority: { weight_threshold: 1, account_auths: [], key_auths: [null] }, last_valid_time: at(-DAY) }],
  })
  const d = deps({ chain: { getState: async () => bad } })
  for (let i = 0; i < 4; i++) assert.equal(await processRow(row(), d), 'error')
  assert.equal(d.calls.put.length, 0)
  assert.equal(await processRow(row(), d), 'failed')
  assert.deepEqual(d.calls.put, [[row().request_id, { status: 'failed', error: 'chain_unavailable' }]])
  assert.equal(d.calls.broadcast.length, 0)
})

test('pollOnce skips null and non-object pending entries', async () => {
  const log = recordingLog()
  const d = deps({ log })
  d.onboard.getPending = async () => [null, 'x', 7, [row()], row({ request_id: 'r-ok' })]
  d.shouldStop = () => false
  assert.equal(await pollOnce(d), 1)
  assert.deepEqual(d.calls.put.map((p) => p[0]), ['r-ok'])
  assert.equal(log.lines.filter((l) => l.msg === 'skipping malformed pending entry').length, 4)
})

test('rule failure reports failed with a short code', async () => {
  const d = deps({ chain: { getState: async () => chainState({ ownerHistory: [historyEntry(KEYS.proven, at(-31 * DAY))] }) } })
  const out = await processRow(row(), d)
  assert.equal(out, 'failed')
  assert.equal(d.calls.broadcast.length, 0)
  assert.deepEqual(d.calls.put, [[row().request_id, { status: 'failed', error: 'key_window_closed' }]])
})

test('hourly cap: no broadcast, no PUT, row stays approved', async () => {
  const d = deps({ cap: createHourlyCap(0, () => 0) })
  const out = await processRow(row(), d)
  assert.equal(out, 'skipped')
  assert.equal(d.calls.broadcast.length, 0)
  assert.equal(d.calls.put.length, 0)
})

test('chain read error: no broadcast, no PUT', async () => {
  const d = deps({ chain: { getState: async () => { throw new Error('all nodes down') } } })
  const out = await processRow(row(), d)
  assert.equal(out, 'error')
  assert.equal(d.calls.broadcast.length, 0)
  assert.equal(d.calls.put.length, 0)
})

test('5 consecutive chain read failures report chain_unavailable', async () => {
  const d = deps({ chain: { getState: async () => { throw new Error('all nodes down') } } })
  for (let i = 0; i < 4; i++) assert.equal(await processRow(row(), d), 'error')
  assert.equal(d.calls.put.length, 0)
  assert.equal(await processRow(row(), d), 'failed')
  assert.deepEqual(d.calls.put, [[row().request_id, { status: 'failed', error: 'chain_unavailable' }]])
  assert.equal(d.calls.broadcast.length, 0)
})

test('a successful chain read resets the failure count', async () => {
  let fail = true
  const d = deps({ chain: { getState: async () => { if (fail) throw new Error('down'); return chainState() } } })
  for (let i = 0; i < 4; i++) await processRow(row(), d)
  fail = false
  assert.equal(await processRow(row(), d), 'requested')
  fail = true
  for (let i = 0; i < 4; i++) assert.equal(await processRow(row(), d), 'error')
})

test('dry run: neither broadcasts nor writes back', async () => {
  const d = deps({ config: { recoveryAccount: 'ecency', marginMs: 10 * MIN, dryRun: true } })
  const out = await processRow(row(), d)
  assert.equal(out, 'dry_run')
  assert.equal(d.calls.broadcast.length, 0)
  assert.equal(d.calls.put.length, 0)
  const d2 = deps({
    config: { recoveryAccount: 'ecency', marginMs: 10 * MIN, dryRun: true },
    chain: { getState: async () => chainState({ account: null }) },
  })
  assert.equal(await processRow(row(), d2), 'dry_run')
  assert.equal(d2.calls.put.length, 0)
})

test('broadcast error: row kept, counts toward cap, fails after 3 tries', async () => {
  const d = deps({ signer: { broadcast: async () => { throw new Error('missing required active authority') } } })
  assert.equal(await processRow(row(), d), 'error')
  assert.equal(await processRow(row(), d), 'error')
  assert.equal(d.calls.put.length, 0)
  assert.equal(await processRow(row(), d), 'failed')
  assert.deepEqual(d.calls.put, [[row().request_id, { status: 'failed', error: 'broadcast_error' }]])
  assert.equal(d.cap.count(), 3)
})

test('PUT error after broadcast does not throw; next pass is idempotent', async () => {
  let pending = []
  const d = deps({
    chain: { getState: async () => chainState({ pendingRequests: pending }) },
    signer: {
      broadcast: async (op) => {
        pending = [{ account_to_recover: 'alice', new_owner_authority: op[1].new_owner_authority, expires: at(DAY) }]
        return { id: 'tx1' }
      },
    },
    onboard: { putResult: async () => { throw new Error('502') } },
  })
  assert.equal(await processRow(row(), d), 'put_error')
  const calls = []
  d.onboard = { putResult: async (id, body) => { calls.push(body) } }
  d.signer = { broadcast: async () => { throw new Error('must not broadcast twice') } }
  assert.equal(await processRow(row(), d), 'already_requested')
  assert.deepEqual(calls, [{ status: 'requested' }])
})

test('pollOnce processes rows in order and stops when asked', async () => {
  const seen = []
  let stop = false
  const d = deps({
    chain: { getState: async (u) => { seen.push(u); if (u === 'bob') stop = true; return chainState({ account: null }) } },
  })
  d.onboard.getPending = async () => [row({ username: 'alice' }), row({ username: 'bob' }), row({ username: 'carol' })]
  d.shouldStop = () => stop
  const n = await pollOnce(d)
  assert.deepEqual(seen, ['alice', 'bob'])
  assert.equal(n, 2)
})

test('pollOnce survives a pending fetch error', async () => {
  const d = deps()
  d.onboard.getPending = async () => { throw new Error('connection refused') }
  d.shouldStop = () => false
  assert.equal(await pollOnce(d), 0)
})
