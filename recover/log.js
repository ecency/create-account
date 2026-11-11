'use strict'
// One JSON line per event. Secrets registered via addSecret are scrubbed from every line.
const secrets = new Set()

function addSecret(s) {
  if (typeof s === 'string' && s.length >= 4) secrets.add(s)
}

function scrub(str) {
  let out = str
  for (const s of secrets) out = out.split(s).join('[redacted]')
  return out
}

function errMsg(err) {
  return scrub(String((err && err.message) || err)).slice(0, 300)
}

function write(level, msg, fields) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields })
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout
  stream.write(scrub(line) + '\n')
}

module.exports = {
  addSecret,
  scrub,
  errMsg,
  info: (msg, f = {}) => write('info', msg, f),
  warn: (msg, f = {}) => write('warn', msg, f),
  error: (msg, f = {}) => write('error', msg, f),
}
