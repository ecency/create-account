'use strict'
const fs = require('fs')
const path = require('path')
const log = require('./log')
const { loadConfig } = require('./config')
const { createClient, createChain, createSigner } = require('./chain')
const { createOnboardClient } = require('./onboard')
const { createHourlyCap, signerKeyAuthorized, DEFAULT_MARGIN_MS } = require('./rules')
const { pollOnce } = require('./worker')

// Node 18+ provides both; older versions would fail on the first request.
function missingRuntime(g = globalThis) {
  const missing = []
  if (typeof g.fetch !== 'function') missing.push('fetch')
  if (!g.AbortSignal || typeof g.AbortSignal.timeout !== 'function') missing.push('AbortSignal.timeout')
  return missing
}

function parseArgs(argv) {
  const opts = { once: false }
  for (const a of argv) {
    if (a === '--once') opts.once = true
    else throw new Error(`unknown argument: ${a} (only --once is supported)`)
  }
  return opts
}

// The creator script's config.js, if there is one. A missing file is fine; a broken
// one is an error.
function loadCreatorConfig(dir) {
  const file = path.join(dir, 'config.js')
  return fs.existsSync(file) ? require(file) : null
}

async function runLoop({ once, pollSeconds, pollOnce: poll, sleep, shouldStop }) {
  while (!shouldStop()) {
    await poll()
    if (once || shouldStop()) break
    await sleep(pollSeconds * 1000)
  }
}

async function main(argv, dir) {
  const missing = missingRuntime()
  if (missing.length) {
    log.error(`Node 18 or newer is required (missing ${missing.join(', ')}); running ${process.version}`)
    process.exit(2)
  }
  let opts
  let config
  try {
    opts = parseArgs(argv)
    config = loadConfig(process.env, loadCreatorConfig(dir))
  } catch (e) {
    log.error(log.scrub(String(e.message)))
    process.exit(2)
  }
  log.addSecret(config.workerToken)
  log.addSecret(config.activeWif)

  const client = createClient(config.hiveNodes)
  const chain = createChain(client)

  let signer = null
  if (config.activeWif) {
    try {
      signer = createSigner(client, config.activeWif)
    } catch {
      log.error('the active key is not a valid private key', { key_source: config.keySource })
      process.exit(2)
    }
    const account = await chain.getAccount(config.recoveryAccount)
    if (!signerKeyAuthorized(account, signer.publicKey)) {
      log.error('signing key is not in the recovery account active authority', {
        account: config.recoveryAccount,
        public_key: signer.publicKey,
        key_source: config.keySource,
      })
      process.exit(2)
    }
    log.info('signing key verified', {
      account: config.recoveryAccount,
      public_key: signer.publicKey,
      key_source: config.keySource,
    })
  }

  let stopping = false
  let wake = null
  const stop = (sig) => {
    if (stopping) return
    stopping = true
    log.info('stopping', { signal: sig })
    if (wake) wake()
  }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))

  const deps = {
    config: { ...config, marginMs: DEFAULT_MARGIN_MS },
    chain,
    signer,
    onboard: createOnboardClient(config),
    cap: createHourlyCap(config.maxPerHour),
    log,
    broadcastFailures: new Map(),
    chainFailures: new Map(),
    shouldStop: () => stopping,
  }

  log.info('started', {
    account: config.recoveryAccount,
    nodes: config.hiveNodes.length,
    poll_seconds: config.pollSeconds,
    max_per_hour: config.maxPerHour,
    dry_run: config.dryRun,
    once: opts.once,
  })

  await runLoop({
    once: opts.once,
    pollSeconds: config.pollSeconds,
    pollOnce: () => pollOnce(deps),
    shouldStop: () => stopping,
    sleep: (ms) => new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      wake = () => {
        clearTimeout(timer)
        resolve()
      }
    }).then(() => { wake = null }),
  })
  log.info('stopped')
}

module.exports = { missingRuntime, parseArgs, loadCreatorConfig, runLoop, main }
