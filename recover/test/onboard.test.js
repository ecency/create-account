'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createOnboardClient } = require('../onboard')

function fakeFetch(responses) {
  const calls = []
  const fn = async (url, init = {}) => {
    calls.push({ url, init })
    const r = responses.shift()
    return { ok: r.status < 300, status: r.status, json: async () => r.body }
  }
  fn.calls = calls
  return fn
}

test('GET pending sends the worker token in X-Recovery-Token only', async () => {
  const f = fakeFetch([{ status: 200, body: [{ request_id: 'x' }] }])
  const c = createOnboardClient({ onboardUrl: 'http://on', workerToken: 'tok' }, f)
  assert.deepEqual(await c.getPending(), [{ request_id: 'x' }])
  assert.equal(f.calls[0].url, 'http://on/api/recovery-request/pending')
  assert.equal(f.calls[0].init.method, 'GET')
  assert.equal(f.calls[0].init.headers['X-Recovery-Token'], 'tok')
})

test('PUT result sends the token header and no creator field', async () => {
  const f = fakeFetch([{ status: 200, body: {} }])
  const c = createOnboardClient({ onboardUrl: 'http://on', workerToken: 'tok' }, f)
  await c.putResult('id-1', { status: 'requested', tx_id: 't' })
  assert.equal(f.calls[0].url, 'http://on/api/recovery-request/id-1/result')
  assert.equal(f.calls[0].init.method, 'PUT')
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { status: 'requested', tx_id: 't' })
  assert.equal(f.calls[0].init.headers['X-Recovery-Token'], 'tok')
})

test('errors carry the status but never the token', async () => {
  const f = fakeFetch([{ status: 403, body: {} }])
  const c = createOnboardClient({ onboardUrl: 'http://on', workerToken: 'tok-secret' }, f)
  await assert.rejects(c.getPending(), (e) => /403/.test(e.message) && !e.message.includes('tok-secret'))
  const f2 = async () => { throw new Error('fetch failed http://on/api/recovery-request/pending tok-secret') }
  const c2 = createOnboardClient({ onboardUrl: 'http://on', workerToken: 'tok-secret' }, f2)
  await assert.rejects(c2.getPending(), (e) => !e.message.includes('tok-secret'))
})

test('redirects are never followed, so the token goes nowhere else', async () => {
  const f = fakeFetch([{ status: 302, body: {} }, { status: 301, body: {} }])
  const c = createOnboardClient({ onboardUrl: 'http://on', workerToken: 'tok' }, f)
  await assert.rejects(c.getPending(), /302/)
  await assert.rejects(c.putResult('id-1', { status: 'failed' }), /301/)
  assert.equal(f.calls.length, 2)
  for (const call of f.calls) assert.equal(call.init.redirect, 'manual')
})

test('pending must be an array', async () => {
  const f = fakeFetch([{ status: 200, body: { error: 'x' } }])
  const c = createOnboardClient({ onboardUrl: 'http://on', workerToken: 'tok' }, f)
  await assert.rejects(c.getPending(), /array/)
})
