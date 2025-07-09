import test from 'tape'
import {
  validateRequestMsg,
  validateResponseMsg,
} from '../lib/validate-message.js'
import {
  validRequestMessages,
  validResponseMessages,
} from './fixtures/valid-messages.js'
import invalidMessages from './fixtures/invalid-messages.js'

test('Valid messages return true', (t) => {
  for (const msg of validRequestMessages) {
    t.doesNotThrow(
      () => validateRequestMsg(msg),
      `Message \`${JSON.stringify(msg)}\` is valid`,
    )
  }
  for (const msg of validResponseMessages) {
    t.doesNotThrow(
      () => validateResponseMsg(msg),
      `Message \`${JSON.stringify(msg)}\` is valid`,
    )
  }
  t.end()
})

test('Invalid mesages return false', (t) => {
  for (const msg of invalidMessages) {
    t.throws(
      () => {
        validateRequestMsg(msg)
        validateResponseMsg(msg)
      },
      `Message \`${JSON.stringify(msg)}\` is invalid`,
    )
  }
  t.end()
})
