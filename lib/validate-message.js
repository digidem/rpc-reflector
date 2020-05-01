const { isStringArray } = require('./prop-array-utils')
const { msgType } = require('./constants')
const { types } = require('util')
const isArrayLike = require('validate.io-array-like')

/** @typedef {import("./types").Message} Message */

const objectStreamSuggest =
  'Maybe the stream you are using is not in objectMode?'

/**
 * Checks if a RPC message is valid
 *
 * @param {any | Message} msg
 * @returns {msg is Message} Returns a boolean indicating if message is valid
 */
module.exports = function isValidMessage(msg) {
  let invalid = ''
  if (Buffer.isBuffer(msg)) {
    invalid = `Received a Buffer (expected an array). ${objectStreamSuggest} `
  } else if (typeof msg === 'string') {
    invalid = `Received a string (expected an array). ${objectStreamSuggest} `
  } else if (types.isUint8Array(msg)) {
    invalid = `Received a Uint8Array (expected an array). ${objectStreamSuggest} `
  } else if (!Array.isArray(msg)) {
    invalid = `Invalid message of type '${typeof msg}' (was expecting an array). `
  } else if (msg[0] === msgType.REQUEST) {
    if (typeof msg[1] !== 'number') {
      invalid = `Invalid messageId of type ${typeof msg[1]} (was expecting a number). `
    }
    if (!isStringArray(msg[2])) {
      invalid += `Invalid prop array ${JSON.stringify(msg[2])}. `
    }
    if (!isArrayLike(msg[3])) {
      invalid += `Invalid method arguments (must be an array-like object). `
    }
  } else if (msg[0] === msgType.RESPONSE) {
    if (typeof msg[1] !== 'number') {
      invalid = `Invalid messageId of type ${typeof msg[1]} (was expecting a number). `
    }
    if (typeof msg[2] !== 'undefined' && typeof msg[2] !== 'object') {
      invalid += 'Expected an ErrorObject or null as the 3rd argument. '
    }
  } else if (msg[0] === msgType.EMIT) {
    if (typeof msg[1] !== 'string') {
      invalid = `Invalid eventName: ${msg[1]}. `
    }
    if (!isStringArray(msg[2])) {
      invalid += `Invalid prop array ${JSON.stringify(msg[2])}. `
    }
    if (typeof msg[3] !== 'undefined' && typeof msg[3] !== 'object') {
      invalid += 'Expected an ErrorObject or null as the 3rd argument. '
    }
    if (typeof msg[4] !== 'undefined' && !Array.isArray(msg[4])) {
      invalid += `Invalid returned params for EMIT: got ${msg[4]} expected an Array of JSON objects. `
    }
  } else if (msg[0] === msgType.ON || msg[0] === msgType.OFF) {
    if (typeof msg[1] !== 'string') {
      invalid = `Invalid eventName: ${msg[1]}. `
    }
    if (!isStringArray(msg[2])) {
      invalid += `Invalid prop array ${JSON.stringify(msg[2])}. `
    }
  } else {
    invalid = `Unhandled message type: ${msg[0]}. `
  }

  if (invalid && process.env.NODE_ENV !== 'production') {
    console.warn(
      invalid +
        '(Message was ignored)\n' +
        'Message was: ' +
        JSON.stringify(msg)
    )
  }
  return !invalid
}
