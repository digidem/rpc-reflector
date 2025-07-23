import test from 'tape'
import {
  validateMetadata,
  validateRequestMsg,
  validateResponseMsg,
} from '../lib/validate-message.js'
import {
  validRequestMessages,
  validResponseMessages,
  validMetadata,
} from './fixtures/valid-messages.js'
import invalidMessages, {
  invalidMetadata,
} from './fixtures/invalid-messages.js'

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

test('Valid metadata', (t) => {
  for (const meta of validMetadata) {
    t.doesNotThrow(
      () => validateMetadata(meta),
      `Metadata \`${JSON.stringify(meta)}\` is valid`,
    )
  }
  t.end()
})

test('Invalid metadata', (t) => {
  for (const meta of invalidMetadata) {
    t.throws(
      () => validateMetadata(meta),
      `Metadata \`${JSON.stringify(meta)}\` is invalid`,
    )
  }
  t.end()
})
