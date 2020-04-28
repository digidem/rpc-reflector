const test = require('tape')
const isValidMessage = require('../lib/validate-message')

const validMessages = require('./fixtures/valid-messages.json')

const invalidMessages = require('./fixtures/invalid-messages')

test('Valid messages return true', t => {
  for (const msg of validMessages) {
    t.ok(isValidMessage(msg), `Message \`${JSON.stringify(msg)}\` is valid`)
  }
  t.end()
})

test('Invalid mesages return false', t => {
  for (const msg of invalidMessages) {
    t.false(
      isValidMessage(msg),
      `Message \`${JSON.stringify(msg)}\` is invalid`
    )
  }
  t.end()
})
