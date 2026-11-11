'use strict'

const DEFAULT_ONBOARD_URL = 'https://api.ecency.com'
const ACCOUNT_NAME_RE = /^[a-z][a-z0-9.-]{2,15}$/

function int(env, name, def, problems) {
  const raw = env[name]
  if (raw === undefined || raw === '') return def
  if (!/^\d+$/.test(String(raw).trim()) || Number(raw) <= 0) {
    problems.push(`${name} must be a positive integer`)
    return def
  }
  return Number(raw)
}

// The creator script's config.js: creators[i] signs with privateKeys[i].
function creatorKey(creatorConfig, account) {
  const { creators, privateKeys } = creatorConfig || {}
  if (!Array.isArray(creators) || !Array.isArray(privateKeys)) return null
  const i = creators.indexOf(account)
  const key = i >= 0 ? privateKeys[i] : null
  return typeof key === 'string' && key.trim() ? key.trim() : null
}

function onlyCreator(creatorConfig) {
  const creators = creatorConfig && creatorConfig.creators
  return Array.isArray(creators) && creators.length === 1 ? creators[0] : null
}

// Throws with a list of problems. Never includes secret values in messages.
// creatorConfig is the creator script's config.js when present: it may supply
// RECOVERY_ACCOUNT (when it lists exactly one creator) and the active key.
function loadConfig(env = process.env, creatorConfig = null) {
  const problems = []
  const onboardUrl = (env.ONBOARD_URL || DEFAULT_ONBOARD_URL).trim().replace(/\/+$/, '')
  if (!/^https?:\/\/\S+$/.test(onboardUrl)) problems.push('ONBOARD_URL must be an http(s) URL')

  const workerToken = (env.RECOVERY_WORKER_TOKEN || '').trim()
  if (!workerToken) problems.push('RECOVERY_WORKER_TOKEN is required')

  const recoveryAccount = String((env.RECOVERY_ACCOUNT || '').trim() || onlyCreator(creatorConfig) || '')
  if (!ACCOUNT_NAME_RE.test(recoveryAccount)) {
    problems.push('RECOVERY_ACCOUNT is required (a Hive account name) unless config.js lists exactly one creator')
  }
  const hiveNodes = (env.HIVE_NODES || 'https://api.deathwing.me,https://api.hive.blog,https://techcoderx.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!hiveNodes.length || hiveNodes.some((u) => !/^https?:\/\/\S+$/.test(u))) {
    problems.push('HIVE_NODES must be a comma list of http(s) URLs')
  }

  const pollSeconds = int(env, 'POLL_SECONDS', 15, problems)
  const maxPerHour = int(env, 'MAX_PER_HOUR', 10, problems)

  const dryRaw = (env.DRY_RUN || '0').trim()
  if (dryRaw !== '0' && dryRaw !== '1') problems.push('DRY_RUN must be 0 or 1')
  const dryRun = dryRaw === '1'

  const envWif = (env.RECOVERY_ACTIVE_WIF || '').trim()
  const cfgWif = envWif ? null : creatorKey(creatorConfig, recoveryAccount)
  const activeWif = envWif || cfgWif || null
  const keySource = envWif ? 'env' : cfgWif ? 'config.js' : null
  if (!activeWif && !dryRun) {
    problems.push('RECOVERY_ACTIVE_WIF is required unless DRY_RUN=1 or config.js has a key for RECOVERY_ACCOUNT')
  }

  if (problems.length) throw new Error('invalid config: ' + problems.join('; '))
  return { onboardUrl, workerToken, recoveryAccount, activeWif, keySource, hiveNodes, pollSeconds, maxPerHour, dryRun }
}

module.exports = { loadConfig, DEFAULT_ONBOARD_URL }
