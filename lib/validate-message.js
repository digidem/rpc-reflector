const { msgType } = require('./constants')

/**
 * Checks if a RPC message is valid
 *
 * @param {any} msg
 * @returns {Boolean}
 */
module.exports = function isValidMessage (msg) {
  if (!Array.isArray(msg)) {
    console.warn('Invalid message: not an array. (Message was ignored)')
    return false
  }
  switch (msg[0]) {
    case msgType.REQUEST:
      if (typeof msg[1] !== 'number') {
        console.warn(`Invalid messageId: ${msg[1]}. (Message was ignored)`)
        return false
      }
      if (typeof msg[2] !== 'string') {
        console.warn(`Invalid method name: ${msg[2]}. (Message was ignored)`)
        return false
      }
      return true
    case msgType.RESPONSE:
      if (typeof msg[1] !== 'number') {
        console.warn(`Invalid messageId: ${msg[1]}. (Message was ignored)`)
        return false
      }
      if (typeof msg[2] !== 'undefined' && typeof msg[2] !== 'object') {
        console.warn(
          'Expected an ErrorObject or null as the 3rd argument. (Message was ignored)'
        )
        return false
      }
      return true
    case msgType.EMIT:
      if (typeof msg[2] !== 'undefined' && typeof msg[2] !== 'object') {
        console.warn(
          'Expected an ErrorObject or null as the 3rd argument. (Message was ignored)'
        )
        return false
      }
      if (typeof msg[3] !== 'undefined' && !Array.isArray(msg[3])) {
        console.warn(
          `Invalid returned params for EMIT: got ${msg[3]} expected an Array of JSON objects. (Message was ignored)`
        )
        return false
      }
    // eslint-disable-next-line no-fallthrough
    case msgType.ON:
    case msgType.OFF:
      if (typeof msg[1] !== 'string') {
        console.warn(`Invalid eventName: ${msg[1]}. (Message was ignored)`)
        return false
      }
      return true
    default:
      console.warn(`Unhandled message type: ${msg[0]}`)
      return false
  }
}
