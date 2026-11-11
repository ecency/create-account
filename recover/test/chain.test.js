'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createChain } = require('../chain')
const { KEYS, HEAD, authority, historyEntry, at, DAY } = require('./fixtures')

function account(over = {}) {
  return { name: 'alice', recovery_account: 'ecency', owner: authority([KEYS.current]),
    last_account_recovery: at(-40 * DAY), ...over }
}

function mockClient(over = {}, calls = []) {
  const results = {
    get_accounts: [account()],
    get_owner_history: [historyEntry(KEYS.proven, at(-5 * DAY))],
    get_dynamic_global_properties: { time: HEAD },
    find_account_recovery_requests: { requests: [] },
    ...over,
  }
  return {
    call: async (_api, method) => {
      calls.push(method)
      return results[method]
    },
  }
}

test('getState returns parsed state for good RPC results', async () => {
  const calls = []
  const s = await createChain(mockClient({}, calls)).getState('alice')
  // Filtered account history scans a bounded window and throws on long histories.
  assert.ok(!calls.includes('get_account_history'), calls.join(','))
  assert.equal(s.account.name, 'alice')
  assert.equal(s.ownerHistory.length, 1)
  assert.equal(s.recoverTimeMs, Date.parse(HEAD + 'Z') - 40 * DAY)
  assert.deepEqual(s.pendingRequests, [])
})

test('getState accepts empty owner history and a never-recovered account', async () => {
  const s = await createChain(mockClient({
    get_owner_history: [],
    get_accounts: [account({ last_account_recovery: '1970-01-01T00:00:00' })],
  })).getState('alice')
  assert.deepEqual(s.ownerHistory, [])
  assert.equal(s.recoverTimeMs, null)
})

const bad = [
  ['get_owner_history null', { get_owner_history: null }],
  ['get_owner_history object', { get_owner_history: {} }],
  ['find_account_recovery_requests null', { find_account_recovery_requests: null }],
  ['find_account_recovery_requests without requests array', { find_account_recovery_requests: {} }],
]
for (const [name, value] of [['missing', undefined], ['null', null], ['empty', ''], ['garbage', 'soon'], ['a number', 0]]) {
  test(`getState throws when last_account_recovery is ${name}`, async () => {
    const acc = account()
    if (value === undefined) delete acc.last_account_recovery
    else acc.last_account_recovery = value
    await assert.rejects(createChain(mockClient({ get_accounts: [acc] })).getState('alice'), /last_account_recovery/)
  })
}

for (const [name, over] of bad) {
  test(`getState throws when ${name}`, async () => {
    await assert.rejects(createChain(mockClient(over)).getState('alice'), /unexpected/)
  })
}
