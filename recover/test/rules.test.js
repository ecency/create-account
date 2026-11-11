'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('../rules')
const { KEYS, HEAD, at, DAY, MIN, authority, historyEntry, row, chainState } = require('./fixtures')

const headMs = Date.parse(HEAD + 'Z')
const opts = { recoveryAccount: 'ecency', marginMs: 10 * MIN, capReached: false }

test('parseHiveTime treats chain timestamps as UTC', () => {
  assert.equal(rules.parseHiveTime('2026-11-10T12:00:00'), Date.UTC(2026, 10, 10, 12, 0, 0))
  assert.equal(rules.parseHiveTime('2026-11-10T12:00:00Z'), Date.UTC(2026, 10, 10, 12, 0, 0))
  assert.ok(Number.isNaN(rules.parseHiveTime('nope')))
  assert.ok(Number.isNaN(rules.parseHiveTime(undefined)))
})

test('lastRecoveryTime reads the account field strictly, epoch means never', () => {
  assert.equal(rules.lastRecoveryTime({ last_account_recovery: '2026-11-10T14:25:30' }), Date.UTC(2026, 10, 10, 14, 25, 30))
  assert.equal(rules.lastRecoveryTime({ last_account_recovery: '1970-01-01T00:00:00' }), null)
  for (const v of [undefined, null, '', 'nope', 0, 1731248730, '2026-11-10', '2026-13-40T99:99:99', '2026-02-30T00:00:00', '2026-11-10T14:25:30+05:00']) {
    assert.throws(() => rules.lastRecoveryTime({ last_account_recovery: v }), /last_account_recovery/, String(v))
  }
  assert.throws(() => rules.lastRecoveryTime({}), /last_account_recovery/)
  assert.throws(() => rules.lastRecoveryTime(null), /last_account_recovery/)
})

test('isValidStmPublicKey accepts STM keys only and checks the checksum', () => {
  assert.equal(rules.isValidStmPublicKey(KEYS.newOwner), true)
  assert.equal(rules.isValidStmPublicKey('TST' + KEYS.newOwner.slice(3)), false)
  assert.equal(rules.isValidStmPublicKey(KEYS.newOwner.slice(0, -1) + 'A'), false)
  assert.equal(rules.isValidStmPublicKey(''), false)
  assert.equal(rules.isValidStmPublicKey(null), false)
})

test('findProvenKey: key inside 30 days with margin is valid', () => {
  const r = rules.findProvenKey([historyEntry(KEYS.proven, at(-5 * DAY))], KEYS.proven, {
    headTimeMs: headMs, recoverTimeMs: null, marginMs: 10 * MIN,
  })
  assert.equal(r.ok, true)
  assert.equal(r.validUntilMs, headMs - 5 * DAY + 30 * DAY)
})

test('findProvenKey: key not in history', () => {
  const r = rules.findProvenKey([historyEntry(KEYS.other, at(-5 * DAY))], KEYS.proven, {
    headTimeMs: headMs, recoverTimeMs: null, marginMs: 10 * MIN,
  })
  assert.deepEqual(r, { ok: false, reason: 'key_not_in_history' })
})

test('findProvenKey: window closes inside the 10 minute margin', () => {
  // last_valid + 30d = head + 9 min, so not > head + 10 min
  const lastValid = at(-30 * DAY + 9 * MIN)
  const r = rules.findProvenKey([historyEntry(KEYS.proven, lastValid)], KEYS.proven, {
    headTimeMs: headMs, recoverTimeMs: null, marginMs: 10 * MIN,
  })
  assert.deepEqual(r, { ok: false, reason: 'key_window_closed' })
  const ok = rules.findProvenKey([historyEntry(KEYS.proven, at(-30 * DAY + 11 * MIN))], KEYS.proven, {
    headTimeMs: headMs, recoverTimeMs: null, marginMs: 10 * MIN,
  })
  assert.equal(ok.ok, true)
})

test('findProvenKey: lineage rule is strictly greater than the last recovery', () => {
  const tr = headMs - 3 * DAY
  // key replaced BY the recovery has last_valid_time == T_r: rejected
  const equal = rules.findProvenKey([historyEntry(KEYS.proven, at(-3 * DAY))], KEYS.proven, {
    headTimeMs: headMs, recoverTimeMs: tr, marginMs: 10 * MIN,
  })
  assert.deepEqual(equal, { ok: false, reason: 'key_before_recovery' })
  const before = rules.findProvenKey([historyEntry(KEYS.proven, at(-4 * DAY))], KEYS.proven, {
    headTimeMs: headMs, recoverTimeMs: tr, marginMs: 10 * MIN,
  })
  assert.deepEqual(before, { ok: false, reason: 'key_before_recovery' })
  const after = rules.findProvenKey([historyEntry(KEYS.proven, at(-3 * DAY + 1000))], KEYS.proven, {
    headTimeMs: headMs, recoverTimeMs: tr, marginMs: 10 * MIN,
  })
  assert.equal(after.ok, true)
})

test('findProvenKey: several matches use the latest last_valid_time', () => {
  const hist = [
    historyEntry(KEYS.proven, at(-29 * DAY)),
    historyEntry(KEYS.proven, at(-2 * DAY)),
    historyEntry(KEYS.proven, at(-10 * DAY)),
  ]
  const r = rules.findProvenKey(hist, KEYS.proven, { headTimeMs: headMs, recoverTimeMs: null, marginMs: 0 })
  assert.equal(r.validUntilMs, headMs - 2 * DAY + 30 * DAY)
  // the latest match is before a recovery, an older one after it does not exist: rejected
  const r2 = rules.findProvenKey(hist, KEYS.proven, {
    headTimeMs: headMs, recoverTimeMs: headMs - 1 * DAY, marginMs: 0,
  })
  assert.equal(r2.ok, false)
})

test('pendingRequestMatches: same account and exactly the new key', () => {
  const req = (acct, keys) => ({ account_to_recover: acct, new_owner_authority: authority(keys), expires: at(DAY) })
  assert.equal(rules.pendingRequestMatches([req('alice', [KEYS.newOwner])], 'alice', KEYS.newOwner), true)
  assert.equal(rules.pendingRequestMatches([req('alice', [KEYS.other])], 'alice', KEYS.newOwner), false)
  assert.equal(rules.pendingRequestMatches([req('bob', [KEYS.newOwner])], 'alice', KEYS.newOwner), false)
  assert.equal(rules.pendingRequestMatches([req('alice', [KEYS.newOwner, KEYS.other])], 'alice', KEYS.newOwner), false)
  assert.equal(rules.pendingRequestMatches([], 'alice', KEYS.newOwner), false)
})

// Shapes that carry our key but are not what this worker broadcasts.
const otherShapes = (pub) => [
  ['threshold 2', { weight_threshold: 2, account_auths: [], key_auths: [[pub, 2]] }],
  ['weight 2', { weight_threshold: 1, account_auths: [], key_auths: [[pub, 2]] }],
  ['account auth', { weight_threshold: 1, account_auths: [['bob', 1]], key_auths: [[pub, 1]] }],
  ['no account_auths', { weight_threshold: 1, key_auths: [[pub, 1]] }],
]
const pendingWith = (auth) => [{ account_to_recover: 'alice', new_owner_authority: auth, expires: at(DAY) }]

test('pendingRequestMatches: only the exact shape we broadcast counts', () => {
  for (const [name, auth] of otherShapes(KEYS.newOwner)) {
    assert.equal(rules.pendingRequestMatches(pendingWith(auth), 'alice', KEYS.newOwner), false, name)
  }
  for (const bad of [null, {}, { key_auths: [null] }, { weight_threshold: 1, account_auths: [], key_auths: [null] }]) {
    assert.equal(rules.pendingRequestMatches(pendingWith(bad), 'alice', KEYS.newOwner), false, JSON.stringify(bad))
  }
})

test('decideRow: a same-key request of another shape is foreign, never already requested', () => {
  for (const [name, auth] of otherShapes(KEYS.newOwner)) {
    assert.deepEqual(rules.decideRow(row(), chainState({ pendingRequests: pendingWith(auth) }), opts),
      { action: 'fail', error: 'other_request_pending' }, name)
  }
})

test('decideRow: other_new_owner_pubs only exempts the exact shape we broadcast', () => {
  const r = row({ other_new_owner_pubs: [KEYS.other] })
  assert.deepEqual(rules.decideRow(r, chainState({ pendingRequests: pendingWith(authority([KEYS.other])) }), opts),
    { action: 'broadcast' })
  for (const [name, auth] of otherShapes(KEYS.other)) {
    assert.deepEqual(rules.decideRow(r, chainState({ pendingRequests: pendingWith(auth) }), opts),
      { action: 'fail', error: 'other_request_pending' }, name)
  }
  for (const bad of [null, { key_auths: [null] }]) {
    assert.deepEqual(rules.decideRow(r, chainState({ pendingRequests: pendingWith(bad) }), opts),
      { action: 'fail', error: 'other_request_pending' }, JSON.stringify(bad))
  }
})

test('buildRequestOp shape', () => {
  assert.deepEqual(rules.buildRequestOp('ecency', 'alice', KEYS.newOwner), [
    'request_account_recovery',
    {
      recovery_account: 'ecency',
      account_to_recover: 'alice',
      new_owner_authority: { weight_threshold: 1, account_auths: [], key_auths: [[KEYS.newOwner, 1]] },
      extensions: [],
    },
  ])
})

// ---- per-row decision ----

test('decideRow: happy path broadcasts', () => {
  assert.deepEqual(rules.decideRow(row(), chainState(), opts), { action: 'broadcast' })
})

test('decideRow: already requested on chain, no new broadcast', () => {
  const st = chainState({
    pendingRequests: [{ account_to_recover: 'alice', new_owner_authority: authority([KEYS.newOwner]), expires: at(DAY) }],
  })
  assert.deepEqual(rules.decideRow(row(), st, opts), { action: 'already_requested' })
  // even when the hourly cap is reached
  assert.deepEqual(rules.decideRow(row(), st, { ...opts, capReached: true }), { action: 'already_requested' })
})

test('decideRow: pending request with a foreign key is never overwritten', () => {
  const st = chainState({
    pendingRequests: [{ account_to_recover: 'alice', new_owner_authority: authority([KEYS.other]), expires: at(DAY) }],
  })
  assert.deepEqual(rules.decideRow(row(), st, opts), { action: 'fail', error: 'other_request_pending' })
})

test('decideRow: pending request with our own earlier key may be replaced', () => {
  const st = chainState({
    pendingRequests: [{ account_to_recover: 'alice', new_owner_authority: authority([KEYS.other]), expires: at(DAY) }],
  })
  assert.deepEqual(rules.decideRow(row({ other_new_owner_pubs: [KEYS.other] }), st, opts), { action: 'broadcast' })
})

// ---- replacing our own superseded request (replaces_owner_pub) ----

const pendingFor = (auth) => chainState({
  pendingRequests: [{ account_to_recover: 'alice', new_owner_authority: auth, expires: at(DAY) }],
})

test('decideRow: replaces our superseded request when it matches exactly', () => {
  const st = pendingFor({ weight_threshold: 1, account_auths: [], key_auths: [[KEYS.older, 1]] })
  assert.deepEqual(rules.decideRow(row({ replaces_owner_pub: KEYS.older }), st, opts), { action: 'broadcast' })
  // without the field it is someone else's request
  assert.deepEqual(rules.decideRow(row(), st, opts), { action: 'fail', error: 'other_request_pending' })
  assert.deepEqual(rules.decideRow(row({ replaces_owner_pub: null }), st, opts), { action: 'fail', error: 'other_request_pending' })
})

test('decideRow: any other pending request is still never overwritten', () => {
  const r = row({ replaces_owner_pub: KEYS.older })
  const shapes = [
    ['different key', { weight_threshold: 1, account_auths: [], key_auths: [[KEYS.other, 1]] }],
    ['threshold 2', { weight_threshold: 2, account_auths: [], key_auths: [[KEYS.older, 2]] }],
    ['threshold 2, weight 1', { weight_threshold: 2, account_auths: [], key_auths: [[KEYS.older, 1]] }],
    ['weight 2', { weight_threshold: 1, account_auths: [], key_auths: [[KEYS.older, 2]] }],
    ['extra key', { weight_threshold: 1, account_auths: [], key_auths: [[KEYS.older, 1], [KEYS.other, 1]] }],
    ['account auth', { weight_threshold: 1, account_auths: [['bob', 1]], key_auths: [[KEYS.older, 1]] }],
    ['no account_auths field', { weight_threshold: 1, key_auths: [[KEYS.older, 1]] }],
  ]
  for (const [name, auth] of shapes) {
    assert.deepEqual(rules.decideRow(r, pendingFor(auth), opts), { action: 'fail', error: 'other_request_pending' }, name)
  }
})

test('decideRow: malformed replaces_owner_pub fails the row', () => {
  for (const bad of ['', 'STMnotakey', KEYS.older.slice(0, -1) + 'A', 'TST' + KEYS.older.slice(3), 42, {}, []]) {
    assert.deepEqual(rules.decideRow(row({ replaces_owner_pub: bad }), chainState(), opts),
      { action: 'fail', error: 'invalid_replaces_owner_pub' }, JSON.stringify(bad))
  }
  // absent or null is fine
  assert.deepEqual(rules.decideRow(row({ replaces_owner_pub: null }), chainState(), opts), { action: 'broadcast' })
})

test('decideRow: a row for another recovery account is skipped before anything else', () => {
  for (const ra of ['appreciator', 'Ecency', '', null, undefined, 42]) {
    assert.deepEqual(rules.decideRow(row({ recovery_account: ra }), chainState(), opts),
      { action: 'skip', reason: 'recovery_account_mismatch' }, String(ra))
  }
  // also when the chain still names us and the proof is fine
  assert.deepEqual(rules.decideRow(row({ recovery_account: 'appreciator' }), chainState(), { ...opts, capReached: true }),
    { action: 'skip', reason: 'recovery_account_mismatch' })
  // an unset configured account never matches a row without one
  assert.deepEqual(rules.decideRow(row({ recovery_account: undefined }), chainState(), { ...opts, recoveryAccount: undefined }),
    { action: 'skip', reason: 'recovery_account_mismatch' })
  // a partner worker accepts its own rows
  const partner = chainState({ account: { name: 'alice', recovery_account: 'appreciator', owner: authority([KEYS.current]) } })
  assert.deepEqual(rules.decideRow(row({ recovery_account: 'appreciator' }), partner, { ...opts, recoveryAccount: 'appreciator' }),
    { action: 'broadcast' })
  // the chain check stays: onboard and config agree but the chain moved on
  assert.deepEqual(rules.decideRow(row({ recovery_account: 'appreciator' }), chainState(), { ...opts, recoveryAccount: 'appreciator' }),
    { action: 'fail', error: 'recovery_account_changed' })
})

test('verifyProof: real dhive vector recovers the proven key', () => {
  assert.equal(rules.verifyProof(row()), true)
})

test('verifyProof: rejects wrong key, swapped new key, other nonce, malformed sig', () => {
  assert.equal(rules.verifyProof(row({ proven_key_pub: KEYS.other })), false)
  assert.equal(rules.verifyProof(row({ new_owner_pub: KEYS.other })), false)
  assert.equal(rules.verifyProof(row({ nonce: 'ffffffffffffffffffffffffffffffff' })), false)
  assert.equal(rules.verifyProof(row({ username: 'bob' })), false)
  assert.equal(rules.verifyProof(row({ signature: 'zz' })), false)
  assert.equal(rules.verifyProof(row({ signature: '' })), false)
  assert.equal(rules.verifyProof(row({ signature: undefined })), false)
  assert.equal(rules.verifyProof(row({ nonce: undefined })), false)
})

test('decideRow: cap reached skips and keeps the row', () => {
  assert.deepEqual(rules.decideRow(row(), chainState(), { ...opts, capReached: true }), {
    action: 'skip', reason: 'hourly_cap',
  })
})

const failures = [
  ['invalid new owner key', row({ new_owner_pub: 'STMbad' }), chainState(), 'invalid_new_owner_key'],
  ['invalid username', row({ username: '' }), chainState(), 'invalid_username'],
  ['account missing', row(), chainState({ account: null }), 'account_not_found'],
  ['recovery account changed', row(),
    chainState({ account: { name: 'alice', recovery_account: 'someone', owner: authority([KEYS.current]) } }),
    'recovery_account_changed'],
  ['new key equals proven key', row({ new_owner_pub: KEYS.proven }), chainState(), 'new_key_is_proven_key'],
  ['new key already current owner', row(),
    chainState({ account: { name: 'alice', recovery_account: 'ecency', owner: authority([KEYS.newOwner]) } }),
    'new_key_already_owner'],
  ['stale proven key', row(), chainState({ ownerHistory: [historyEntry(KEYS.proven, at(-31 * DAY))] }),
    'key_window_closed'],
  ['proof signed by another key', row({ proven_key_pub: KEYS.other }),
    chainState({ ownerHistory: [historyEntry(KEYS.other, at(-5 * DAY))] }), 'invalid_proof'],
  ['proof missing', row({ signature: undefined }), chainState(), 'invalid_proof'],
  ['proven key not sufficient alone', row(),
    chainState({ ownerHistory: [{ ...historyEntry(KEYS.proven, at(-5 * DAY)),
      previous_owner_authority: { weight_threshold: 2, account_auths: [], key_auths: [[KEYS.proven, 1], [KEYS.other, 1]] } }] }),
    'key_not_sufficient'],
  ['proven key not in history', row(), chainState({ ownerHistory: [historyEntry(KEYS.other, at(-1 * DAY))] }),
    'key_not_in_history'],
  ['newer recover_account', row(),
    chainState({ recoverTimeMs: headMs - 2 * DAY }), 'key_before_recovery'],
  ['proven key replaced by the last recovery', row(),
    chainState({ ownerHistory: [historyEntry(KEYS.proven, at(-2 * DAY))], recoverTimeMs: headMs - 2 * DAY }),
    'key_before_recovery'],
]

for (const [name, r, st, code] of failures) {
  test(`decideRow fails: ${name}`, () => {
    assert.deepEqual(rules.decideRow(r, st, opts), { action: 'fail', error: code })
  })
}

test('decideRow: a failing rule wins over the hourly cap', () => {
  assert.deepEqual(rules.decideRow(row(), chainState({ account: null }), { ...opts, capReached: true }), {
    action: 'fail', error: 'account_not_found',
  })
})

test('hourly cap counts broadcasts in a rolling hour', () => {
  let now = 0
  const cap = rules.createHourlyCap(2, () => now)
  assert.equal(cap.reached(), false)
  cap.record()
  cap.record()
  assert.equal(cap.reached(), true)
  now = 3600 * 1000 - 1
  assert.equal(cap.reached(), true)
  now = 3600 * 1000 + 1
  assert.equal(cap.reached(), false)
})

test('signerKeyAuthorized: key must be in active with weight >= threshold', () => {
  const acct = (keyAuths, threshold = 1) => ({ active: { weight_threshold: threshold, account_auths: [], key_auths: keyAuths } })
  assert.equal(rules.signerKeyAuthorized(acct([[KEYS.other, 1], [KEYS.newOwner, 1]]), KEYS.newOwner), true)
  assert.equal(rules.signerKeyAuthorized(acct([[KEYS.other, 1]]), KEYS.newOwner), false)
  assert.equal(rules.signerKeyAuthorized(acct([[KEYS.newOwner, 1]], 2), KEYS.newOwner), false)
  assert.equal(rules.signerKeyAuthorized(null, KEYS.newOwner), false)
})

const weighted = (lastValid, threshold, weight = 1) => ({
  ...historyEntry(KEYS.proven, lastValid),
  previous_owner_authority: { weight_threshold: threshold, account_auths: [], key_auths: [[KEYS.proven, weight], [KEYS.other, 1]] },
})

test('findProvenKey: falls back to an older usable entry where the key is sufficient', () => {
  const older = at(-10 * DAY)
  const hist = [weighted(at(-2 * DAY), 2), weighted(older, 1)]
  const r = rules.findProvenKey(hist, KEYS.proven, { headTimeMs: headMs, recoverTimeMs: null, marginMs: 10 * MIN })
  assert.deepEqual(r, { ok: true, validUntilMs: Date.parse(older + 'Z') + 30 * DAY })
})

test('findProvenKey: a sufficient entry outside the usable set does not count', () => {
  // older sufficient entry predates the last recovery
  let r = rules.findProvenKey([weighted(at(-2 * DAY), 2), weighted(at(-10 * DAY), 1)], KEYS.proven, {
    headTimeMs: headMs, recoverTimeMs: headMs - 5 * DAY, marginMs: 10 * MIN,
  })
  assert.deepEqual(r, { ok: false, reason: 'key_not_sufficient' })
  // older sufficient entry is outside the 30-day window
  r = rules.findProvenKey([weighted(at(-2 * DAY), 2), weighted(at(-31 * DAY), 1)], KEYS.proven, {
    headTimeMs: headMs, recoverTimeMs: null, marginMs: 10 * MIN,
  })
  assert.deepEqual(r, { ok: false, reason: 'key_not_sufficient' })
  // sufficient entries before the recovery only: still a lineage failure
  r = rules.findProvenKey([weighted(at(-10 * DAY), 1)], KEYS.proven, {
    headTimeMs: headMs, recoverTimeMs: headMs - 5 * DAY, marginMs: 10 * MIN,
  })
  assert.deepEqual(r, { ok: false, reason: 'key_before_recovery' })
})

test('findProvenKey: picks the latest of several sufficient usable entries', () => {
  const newest = at(-3 * DAY)
  const hist = [weighted(at(-1 * DAY), 2), weighted(at(-9 * DAY), 1), weighted(newest, 1, 2)]
  const r = rules.findProvenKey(hist, KEYS.proven, { headTimeMs: headMs, recoverTimeMs: null, marginMs: 10 * MIN })
  assert.deepEqual(r, { ok: true, validUntilMs: Date.parse(newest + 'Z') + 30 * DAY })
})

test('findProvenKey: on chain the replaced key ends one block before the recover_account op', () => {
  // Observed on mainnet: recover_account op timestamp T, replaced owner entry last_valid_time T - 3s
  // (hived stamps owner_history with the previous block time). Still rejected.
  const tr = headMs - 2 * DAY
  const r = rules.findProvenKey([historyEntry(KEYS.current, at(-2 * DAY - 3000))], KEYS.current, {
    headTimeMs: headMs, recoverTimeMs: tr, marginMs: 10 * MIN,
  })
  assert.deepEqual(r, { ok: false, reason: 'key_before_recovery' })
})
