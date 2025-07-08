import test from 'tape'
import { isValidMessage } from '../lib/validate-message.js'
import validMessages from './fixtures/valid-messages.js'
import invalidMessages from './fixtures/invalid-messages.js'

test('Valid messages return true', (t) => {
  for (const msg of validMessages) {
    t.ok(isValidMessage(msg), `Message \`${JSON.stringify(msg)}\` is valid`)
  }
  t.end()
})

test('Invalid mesages return false', (t) => {
  for (const msg of invalidMessages) {
    t.false(
      isValidMessage(msg),
      `Message \`${JSON.stringify(msg)}\` is invalid`,
    )
  }
  t.end()
})
