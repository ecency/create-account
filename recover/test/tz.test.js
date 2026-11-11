'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')

// Chain timestamps have no zone suffix. Running the suite in a UTC zone would hide
// a parser that reads them as local time, so npm test pins a non-UTC TZ.
test('suite runs in a non-UTC time zone', () => {
  assert.notEqual(new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset(), 0)
})
