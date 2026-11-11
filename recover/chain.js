'use strict'
const { Client, PrivateKey } = require('@hiveio/dhive')
const { parseHiveTime, lastRecoveryTime } = require('./rules')

function createClient(nodes) {
  return new Client(nodes, { timeout: 10000, failoverThreshold: 2, consoleOnFailover: false })
}

function createChain(client) {
  return {
    async getAccount(name) {
      const [acc] = await client.call('condenser_api', 'get_accounts', [[name]])
      return acc || null
    },

    // Everything decideRow needs, read fresh for one account.
    async getState(username) {
      const account = await this.getAccount(username)
      if (!account) return { account: null }
      // From the account object, not filtered account history: that scans a bounded
      // window of ops and throws on accounts with long histories.
      const recoverTimeMs = lastRecoveryTime(account)
      const [ownerHistory, props, pending] = await Promise.all([
        client.call('condenser_api', 'get_owner_history', [username]),
        client.call('condenser_api', 'get_dynamic_global_properties', []),
        client.call('database_api', 'find_account_recovery_requests', { accounts: [username] }),
      ])
      // A null or odd result must not read as "no history" / "never recovered":
      // that would silently disable the lineage rule. Throw so the row is retried.
      if (!Array.isArray(ownerHistory)) throw new Error('unexpected get_owner_history result')
      if (!pending || !Array.isArray(pending.requests)) {
        throw new Error('unexpected find_account_recovery_requests result')
      }
      const headTimeMs = parseHiveTime(props && props.time)
      if (Number.isNaN(headTimeMs)) throw new Error('bad head block time')
      return {
        account,
        ownerHistory,
        recoverTimeMs,
        headTimeMs,
        pendingRequests: pending.requests,
      }
    },
  }
}

function createSigner(client, wif) {
  const key = PrivateKey.fromString(wif)
  return {
    publicKey: key.createPublic('STM').toString(),
    broadcast: (op) => client.broadcast.sendOperations([op], key),
  }
}

module.exports = { createClient, createChain, createSigner }
