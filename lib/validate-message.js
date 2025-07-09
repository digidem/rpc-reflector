import { isStringArray } from './prop-array-utils.js'
import { msgType } from './constants.js'

/** @import {MsgRequest, MsgOn, MsgOff, MsgResponse, MsgEmit, MsgId} from './types.js' */
const objectStreamSuggest =
  'Maybe the stream you are using is not in objectMode?'

/**
 *
 * @param {unknown} msg
 * @returns {asserts msg is [number, ...any[]]}
 */
function validateMsgArray(msg) {
  if (!Array.isArray(msg)) {
    const msgType = ArrayBuffer.isView(msg) ? 'ArrayBuffer' : typeof msg
    throw new TypeError(
      `Invalid message of type '${msgType}' (was expecting an array). ${objectStreamSuggest}`,
    )
  }
  if (msg.length === 0) {
    throw new Error('Received an empty message array.')
  }
  if (typeof msg[0] !== 'number') {
    throw new TypeError(
      `Expected the first element to be a number, but received a ${typeof msg[0]}.`,
    )
  }
}

/**
 * @param {unknown} msg
 * @returns {asserts msg is MsgRequest | MsgOn | MsgOff}
 */
export function validateRequestMsg(msg) {
  validateMsgArray(msg)
  const errors = []

  switch (msg[0]) {
    case msgType.REQUEST:
      if (typeof msg[1] !== 'number') {
        errors.push(
          new TypeError(
            `Invalid messageId of type ${typeof msg[1]} (was expecting a number).`,
          ),
        )
      }
      if (!isStringArray(msg[2])) {
        errors.push(
          new TypeError(`Invalid prop array ${JSON.stringify(msg[2])}.`),
        )
      }
      if (!Array.isArray(msg[3])) {
        errors.push(
          new TypeError(`Invalid method arguments (must be an array).`),
        )
      }
      break
    case msgType.ON:
    case msgType.OFF:
      if (typeof msg[1] !== 'string') {
        errors.push(new Error(`Invalid eventName: ${msg[1]}. `))
      }
      if (!isStringArray(msg[2])) {
        errors.push(
          new TypeError(`Invalid prop array ${JSON.stringify(msg[2])}. `),
        )
      }
      break
    default:
      throw new Error(`Unhandled message type: ${msg[0]}.`)
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Invalid request message')
  }
}

/**
 * @param {unknown} msg
 * @returns {asserts msg is MsgResponse | MsgEmit}
 */
export function validateResponseMsg(msg) {
  validateMsgArray(msg)
  const errors = []

  switch (msg[0]) {
    case msgType.RESPONSE:
      if (typeof msg[1] !== 'number') {
        errors.push(
          new TypeError(
            `Invalid messageId of type ${typeof msg[1]} (was expecting a number).`,
          ),
        )
      }
      if (typeof msg[2] !== 'undefined' && typeof msg[2] !== 'object') {
        errors.push(
          new Error('Expected an ErrorObject or null as the 3rd argument.`'),
        )
      }
      break
    case msgType.EMIT:
      if (typeof msg[1] !== 'string') {
        errors.push(new TypeError(`Invalid eventName: ${msg[1]}.`))
      }
      if (!isStringArray(msg[2])) {
        errors.push(
          new TypeError(`Invalid prop array ${JSON.stringify(msg[2])}.`),
        )
      }
      if (typeof msg[3] !== 'undefined' && typeof msg[3] !== 'object') {
        errors.push(
          new TypeError('Expected an ErrorObject or null as the 3rd argument.'),
        )
      }
      if (typeof msg[4] !== 'undefined' && !Array.isArray(msg[4])) {
        errors.push(
          new TypeError(
            `Invalid returned params for EMIT: got ${msg[4]} expected an Array of JSON objects.`,
          ),
        )
      }
      break
    default:
      throw new Error(`Unhandled message type: ${msg[0]}.`)
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Invalid response message')
  }
}
