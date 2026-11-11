'use strict'
// Pure chain rules for a recovery request. No I/O here.
const { PublicKey, Signature, cryptoUtils } = require('@hiveio/dhive')

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const OWNER_HISTORY_WINDOW_MS = 30 * DAY_MS
const DEFAULT_MARGIN_MS = 10 * MINUTE_MS
const ACCOUNT_NAME_RE = /^[a-z][a-z0-9.-]{2,15}$/

// Chain timestamps are UTC without a zone suffix.
function parseHiveTime(s) {
  if (typeof s !== 'string' || !s) return NaN
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z')
}

const NEVER_RECOVERED = '1970-01-01T00:00:00'

// Time of the account's latest recover_account, from the account object. The chain
// keeps the epoch there for accounts never recovered -> null. Anything else that is
// not an exact chain timestamp throws: reading it as "never recovered" would
// silently drop the lineage rule.
function lastRecoveryTime(account) {
  const s = account && account.last_account_recovery
  if (s === NEVER_RECOVERED) return null
  const t = parseHiveTime(s)
  // Round trip: only an exact, real yyyy-mm-ddThh:mm:ss passes.
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 19) !== s) {
    throw new Error('unexpected last_account_recovery')
  }
  return t
}

function isValidStmPublicKey(s) {
  if (typeof s !== 'string' || !s.startsWith('STM')) return false
  try {
    return PublicKey.fromString(s).toString() === s
  } catch {
    return false
  }
}

function hasKey(authority, key) {
  return !!authority && Array.isArray(authority.key_auths) && authority.key_auths.some((ka) => ka[0] === key)
}

// The signer recomputes the proof itself instead of trusting upstream checks.
function verifyProof(row) {
  const { username, new_owner_pub: newPub, nonce, signature, proven_key_pub: provenPub } = row || {}
  if (typeof nonce !== 'string' || !nonce) return false
  if (typeof signature !== 'string' || !/^[0-9a-f]{130}$/i.test(signature)) return false
  try {
    const digest = cryptoUtils.sha256(`ecency-recovery:${username}:${newPub}:${nonce}`)
    return Signature.fromString(signature).recover(digest, 'STM').toString() === provenPub
  } catch {
    return false
  }
}

// Returns {ok:true, validUntilMs} or {ok:false, reason}.
// Usable entries: inside the 30-day window (with margin) and strictly newer than the
// last recovery. Of those, the latest where the proven key alone satisfies the
// authority wins, so an older sufficient entry is used when a newer one is not
// (the same choice the gateway and the page make).
function findProvenKey(ownerHistory, provenPub, { headTimeMs, recoverTimeMs, marginMs }) {
  const matches = []
  for (const entry of ownerHistory || []) {
    if (!hasKey(entry.previous_owner_authority, provenPub)) continue
    const t = parseHiveTime(entry.last_valid_time)
    if (!Number.isNaN(t)) matches.push({ t, auth: entry.previous_owner_authority })
  }
  if (!matches.length) return { ok: false, reason: 'key_not_in_history' }
  const recovered = recoverTimeMs !== null && recoverTimeMs !== undefined
  // Strictly greater: the key replaced BY a recovery has last_valid_time == T_r.
  const afterRecovery = matches.filter((m) => !recovered || m.t > recoverTimeMs)
  if (!afterRecovery.length) return { ok: false, reason: 'key_before_recovery' }
  const usable = afterRecovery.filter((m) => m.t + OWNER_HISTORY_WINDOW_MS > headTimeMs + marginMs)
  if (!usable.length) return { ok: false, reason: 'key_window_closed' }
  // recover_account needs that exact authority satisfied by the proven key alone.
  let latest = NaN
  for (const { t, auth } of usable) {
    const weight = auth.key_auths.find((ka) => ka[0] === provenPub)[1]
    if (weight >= auth.weight_threshold && !(t <= latest)) latest = t
  }
  if (Number.isNaN(latest)) return { ok: false, reason: 'key_not_sufficient' }
  return { ok: true, validUntilMs: latest + OWNER_HISTORY_WINDOW_MS }
}

function pendingRequestMatches(requests, username, newOwnerPub) {
  return (requests || []).some((r) => {
    const ka = r && r.new_owner_authority && r.new_owner_authority.key_auths
    return (
      r.account_to_recover === username &&
      Array.isArray(ka) &&
      ka.length === 1 &&
      ka[0][0] === newOwnerPub &&
      (r.new_owner_authority.account_auths || []).length === 0
    )
  })
}

// Exactly the authority this signer broadcasts for a key: threshold 1, that key at
// weight 1, nothing else.
function isOurRequestFor(authority, pub) {
  const ka = authority && authority.key_auths
  return (
    authority.weight_threshold === 1 &&
    Array.isArray(authority.account_auths) &&
    authority.account_auths.length === 0 &&
    Array.isArray(ka) &&
    ka.length === 1 &&
    Array.isArray(ka[0]) &&
    ka[0][0] === pub &&
    ka[0][1] === 1
  )
}

function buildRequestOp(recoveryAccount, username, newOwnerPub) {
  return [
    'request_account_recovery',
    {
      recovery_account: recoveryAccount,
      account_to_recover: username,
      new_owner_authority: { weight_threshold: 1, account_auths: [], key_auths: [[newOwnerPub, 1]] },
      extensions: [],
    },
  ]
}

// Decide what to do with one approved row given fresh chain state.
// -> {action:'broadcast'} | {action:'already_requested'} | {action:'fail', error} | {action:'skip', reason}
function decideRow(row, chain, { recoveryAccount, marginMs = DEFAULT_MARGIN_MS, capReached = false }) {
  const fail = (error) => ({ action: 'fail', error })
  // onboard sends each worker only its own account's rows; check anyway.
  if (!row || typeof row.recovery_account !== 'string' || row.recovery_account !== recoveryAccount) {
    return fail('recovery_account_mismatch')
  }
  if (!row || typeof row.username !== 'string' || !ACCOUNT_NAME_RE.test(row.username)) return fail('invalid_username')
  if (!isValidStmPublicKey(row.new_owner_pub)) return fail('invalid_new_owner_key')
  if (!isValidStmPublicKey(row.proven_key_pub)) return fail('invalid_proven_key')
  if (row.new_owner_pub === row.proven_key_pub) return fail('new_key_is_proven_key')
  // The user's own earlier on-chain request, superseded by this approved attempt.
  const replaces = row.replaces_owner_pub
  if (replaces !== undefined && replaces !== null && !isValidStmPublicKey(replaces)) {
    return fail('invalid_replaces_owner_pub')
  }
  if (!verifyProof(row)) return fail('invalid_proof')

  const account = chain.account
  if (!account) return fail('account_not_found')
  if (account.recovery_account !== recoveryAccount) return fail('recovery_account_changed')
  if (hasKey(account.owner, row.new_owner_pub)) return fail('new_key_already_owner')

  // Idempotency: our earlier broadcast already landed (e.g. crash before the PUT).
  if (pendingRequestMatches(chain.pendingRequests, row.username, row.new_owner_pub)) {
    return { action: 'already_requested' }
  }
  // Never overwrite a pending request this worker did not make for this user.
  const ours = new Set(Array.isArray(row.other_new_owner_pubs) ? row.other_new_owner_pubs : [])
  const foreign = (chain.pendingRequests || []).some((r) => {
    if (!r || r.account_to_recover !== row.username) return false
    if (replaces && r.new_owner_authority && isOurRequestFor(r.new_owner_authority, replaces)) return false
    const ka = (r.new_owner_authority && r.new_owner_authority.key_auths) || []
    return !(ka.length === 1 && ours.has(ka[0][0]) && (r.new_owner_authority.account_auths || []).length === 0)
  })
  if (foreign) return fail('other_request_pending')

  const proven = findProvenKey(chain.ownerHistory, row.proven_key_pub, {
    headTimeMs: chain.headTimeMs,
    recoverTimeMs: chain.recoverTimeMs,
    marginMs,
  })
  if (!proven.ok) return fail(proven.reason)

  if (capReached) return { action: 'skip', reason: 'hourly_cap' }
  return { action: 'broadcast' }
}

// Signer key must sit in the recovery account's active authority with enough weight alone.
function signerKeyAuthorized(account, pubKey) {
  const active = account && account.active
  if (!active || !Array.isArray(active.key_auths)) return false
  return active.key_auths.some(([k, w]) => k === pubKey && w >= active.weight_threshold)
}

function createHourlyCap(max, now = Date.now) {
  let stamps = []
  const prune = () => {
    const cutoff = now() - HOUR_MS
    stamps = stamps.filter((t) => t > cutoff)
  }
  return {
    reached() {
      prune()
      return stamps.length >= max
    },
    record() {
      stamps.push(now())
    },
    count() {
      prune()
      return stamps.length
    },
  }
}

module.exports = {
  MINUTE_MS,
  DAY_MS,
  DEFAULT_MARGIN_MS,
  parseHiveTime,
  lastRecoveryTime,
  isValidStmPublicKey,
  verifyProof,
  findProvenKey,
  pendingRequestMatches,
  buildRequestOp,
  decideRow,
  signerKeyAuthorized,
  createHourlyCap,
}
