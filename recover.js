'use strict'
// Signs request_account_recovery for recovery requests Ecency has already verified.
// See README, "Recovery requests (optional)". Usage: node recover.js [--once]
const log = require('./recover/log')
const { main } = require('./recover/main')

main(process.argv.slice(2), __dirname)
  .then(() => process.exit(0))
  .catch((e) => {
    log.error('fatal', { err: log.errMsg(e) })
    process.exit(1)
  })
