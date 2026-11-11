'use strict'
const { PrivateKey } = require('@hiveio/dhive')

const pub = (seed) => PrivateKey.fromSeed(seed).createPublic('STM').toString()

const KEYS = {
  current: pub('current-owner'),
  proven: pub('user-old-owner'),
  older: pub('user-older-owner'),
  newOwner: pub('user-new-owner'),
  other: pub('someone-else'),
}

// Real dhive vector: PrivateKey.fromSeed('user-old-owner').sign(
//   sha256('ecency-recovery:alice:' + KEYS.newOwner + ':' + NONCE)).toString()
const NONCE = '0123456789abcdef0123456789abcdef'
const PROOF_SIG =
  '1f58e44176ebe27de3d47f394e7c1c1e2afd41d5c4e7f051e1e92c099b8c23f4af45ca7eeb59599befbe4566f7e5dc741005421760bbfc8fed0c6ba6d231119745'

const HEAD = '2026-11-10T12:00:00'
const iso = (ms) => new Date(ms).toISOString().slice(0, 19)
const at = (offsetMs) => iso(Date.parse(HEAD + 'Z') + offsetMs)
const DAY = 24 * 3600 * 1000
const MIN = 60 * 1000

function authority(keys) {
  return { weight_threshold: 1, account_auths: [], key_auths: keys.map((k) => [k, 1]) }
}

function historyEntry(key, lastValid) {
  return {
    id: 1,
    account: 'alice',
    previous_owner_authority: authority([key]),
    last_valid_time: lastValid,
  }
}

function row(over = {}) {
  return {
    request_id: '6f1c0f8e-1111-4222-8333-444455556666',
    username: 'alice',
    new_owner_pub: KEYS.newOwner,
    proven_key_pub: KEYS.proven,
    nonce: NONCE,
    signature: PROOF_SIG,
    proven_key_valid_until: at(25 * DAY),
    other_new_owner_pubs: [],
    recovery_account: 'ecency',
    ...over,
  }
}

function chainState(over = {}) {
  return {
    account: { name: 'alice', recovery_account: 'ecency', owner: authority([KEYS.current]) },
    ownerHistory: [historyEntry(KEYS.proven, at(-5 * DAY))],
    recoverTimeMs: null,
    headTimeMs: Date.parse(HEAD + 'Z'),
    pendingRequests: [],
    ...over,
  }
}

module.exports = { NONCE, PROOF_SIG, KEYS, HEAD, at, DAY, MIN, authority, historyEntry, row, chainState }
