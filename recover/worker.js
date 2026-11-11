'use strict'
const { decideRow, buildRequestOp } = require('./rules')

const MAX_BROADCAST_ATTEMPTS = 3
const MAX_CHAIN_READ_FAILURES = 5

function errMsg(log, e) {
  return log.errMsg ? log.errMsg(e) : String((e && e.message) || e).slice(0, 300)
}

// Handles one approved row. Never throws. Returns an outcome string for logs/tests:
// requested | already_requested | failed | skipped | dry_run | error | put_error
async function processRow(row, d) {
  const { config, chain, signer, onboard, cap, log } = d
  const ctx = { request_id: row && row.request_id, username: row && row.username }

  let state
  try {
    state = await chain.getState(row.username)
    d.chainFailures.delete(row.request_id)
  } catch (e) {
    const n = (d.chainFailures.get(row.request_id) || 0) + 1
    d.chainFailures.set(row.request_id, n)
    log.warn('chain read failed', { ...ctx, attempt: n, err: errMsg(log, e) })
    if (n < MAX_CHAIN_READ_FAILURES || config.dryRun) return 'error'
    d.chainFailures.delete(row.request_id)
    return writeBack(row, { status: 'failed', error: 'chain_unavailable' }, 'failed', d, ctx)
  }

  const decision = decideRow(row, state, {
    recoveryAccount: config.recoveryAccount,
    marginMs: config.marginMs,
    capReached: cap.reached(),
  })

  if (config.dryRun) {
    log.info('dry run decision', { ...ctx, decision: decision.action, error: decision.error, reason: decision.reason })
    return 'dry_run'
  }

  let result
  let outcome
  if (decision.action === 'skip') {
    log.error('hourly broadcast cap reached, leaving request approved', { ...ctx, cap: config.maxPerHour })
    return 'skipped'
  } else if (decision.action === 'fail') {
    log.info('re-check failed', { ...ctx, error: decision.error })
    result = { status: 'failed', error: decision.error }
    outcome = 'failed'
  } else if (decision.action === 'already_requested') {
    log.info('request already on chain, not broadcasting again', ctx)
    result = { status: 'requested' }
    outcome = 'already_requested'
  } else {
    const op = buildRequestOp(config.recoveryAccount, row.username, row.new_owner_pub)
    cap.record() // count attempts, so a broken signer cannot loop past the cap
    try {
      const conf = await signer.broadcast(op)
      d.broadcastFailures.delete(row.request_id)
      result = { status: 'requested', tx_id: conf && conf.id }
      outcome = 'requested'
      log.info('request_account_recovery broadcast', { ...ctx, tx_id: result.tx_id })
    } catch (e) {
      // The tx may still have landed; the next pass sees it via find_account_recovery_requests.
      const n = (d.broadcastFailures.get(row.request_id) || 0) + 1
      d.broadcastFailures.set(row.request_id, n)
      log.error('broadcast failed', { ...ctx, attempt: n, err: errMsg(log, e) })
      if (n < MAX_BROADCAST_ATTEMPTS) return 'error'
      d.broadcastFailures.delete(row.request_id)
      result = { status: 'failed', error: 'broadcast_error' }
      outcome = 'failed'
    }
  }

  return writeBack(row, result, outcome, d, ctx)
}

async function writeBack(row, result, outcome, d, ctx) {
  try {
    await d.onboard.putResult(row.request_id, result)
  } catch (e) {
    d.log.error('result write-back failed', { ...ctx, status: result.status, err: errMsg(d.log, e) })
    return 'put_error'
  }
  return outcome
}

// One poll pass. Returns the number of rows handled. Never throws.
async function pollOnce(d) {
  let rows
  try {
    rows = await d.onboard.getPending()
  } catch (e) {
    d.log.warn('pending fetch failed', { err: errMsg(d.log, e) })
    return 0
  }
  let n = 0
  for (const row of rows) {
    if (d.shouldStop()) break
    await processRow(row, d)
    n++
  }
  return n
}

module.exports = { processRow, pollOnce, MAX_BROADCAST_ATTEMPTS, MAX_CHAIN_READ_FAILURES }
