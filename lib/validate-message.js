const { msgType } = require('./constants')
const { types } = require('util')

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
    if (
      !Array.isArray(msg[2]) ||
      !msg[2].every((key) => typeof key === 'string')
    ) {
      invalid += `Invalid method name of type ${typeof msg[2]} (was expecting a string). `
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
    if (typeof msg[2] !== 'undefined' && typeof msg[2] !== 'object') {
      invalid += 'Expected an ErrorObject or null as the 3rd argument. '
    }
    if (typeof msg[3] !== 'undefined' && !Array.isArray(msg[3])) {
      invalid += `Invalid returned params for EMIT: got ${msg[3]} expected an Array of JSON objects. `
    }
  } else if (msg[0] === msgType.ON || msg[0] === msgType.OFF) {
    if (typeof msg[1] !== 'string') {
      invalid = `Invalid eventName: ${msg[1]}. `
    }
  } else {
    invalid = `Unhandled message type: ${msg[0]}. `
  }

  if (invalid && process.env.NODE_ENV !== 'production') {
    console.warn(invalid + '(Message was ignored)')
  }
  return !invalid
}
