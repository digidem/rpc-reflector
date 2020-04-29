const EventEmitter = require('events').EventEmitter
const assert = require('assert')
const { serializeError } = require('serialize-error')
const isStream = require('is-stream')

const { msgType } = require('./lib/constants')
const isValidMessage = require('./lib/validate-message')
const MessageStream = require('./lib/message-stream')
const isObjectMode = require('./lib/is-object-mode-readable')

/** @typedef {import('./lib/types').MsgRequest} MsgRequest */
/** @typedef {import('./lib/types').MsgResponse} MsgResponse */
/** @typedef {import('./lib/types').MsgOn} MsgOn */
/** @typedef {import('./lib/types').MsgOff} MsgOff */
/** @typedef {import('./lib/types').MsgEmit} MsgEmit */
/** @typedef {import('./lib/types').Message} Message */

module.exports = createServer

/**
 * @public
 * Create an RPC server that will receive messages via `receiver`, call the
 * matching method on `handler`, and send the reply via `send`.
 *
 * @param {{[method: string]: any}} handler Any method called on the client
 * object will be called on this object. Methods can return a value, a Promise,
 * or a ReadableStream. Your transport stream must be able to encode/decode any
 * values that your handler returns
 * @param {import('stream').Duplex} duplex Duplex Stream with objectMode=true
 *
 * @returns {{ close: () => void }} An object with a single method `close()`
 * that will stop the server listening to and sending any more messages
 */
function createServer(handler, duplex) {
  assert(typeof handler === 'object', 'Missing handler object.')
  assert(isStream.duplex(duplex), 'Must pass a duplex stream as first argument')

  /** @type {Map<string, (...args: any[]) => void>} */
  let subscriptions = new Map()

  duplex.on('data', handleMessage)

  /** @param {MsgResponse | MsgEmit} msg */
  function send(msg) {
    // TODO: Do we need back pressure here? Would just result in buffering here
    // vs. buffering in the stream, so probably no
    duplex.write(msg)
  }

  /**
   * Handles an incoming message.
   * @param {any} msg Can be any type, but we only process messages types that
   * we understand, other messages are ignored
   */
  function handleMessage(msg) {
    if (!isValidMessage(msg)) return
    switch (msg[0]) {
      case msgType.REQUEST:
        return handleRequest(/** @type {MsgRequest} */ (msg))
      case msgType.ON:
        return handleOn(/** @type {MsgOn} */ (msg))
      case msgType.OFF:
        return handleOff(/** @type {MsgOff} */ (msg))
      default:
        console.warn(`Unhandled message type: ${msg[0]}. (Message was ignored)`)
    }
  }

  /** @param {MsgRequest} msg */
  async function handleRequest(msg) {
    const [, msgId, propertyKeys, params] = msg
    /** @type {MsgResponse} */
    let response

    if (!isFunction(handler, propertyKeys)) {
      const error = new Error('Method not supported')
      response = [msgType.RESPONSE, msgId, serializeError(error)]
    } else {
      try {
        const result = await Promise.resolve(
          applyMethodChain(handler, propertyKeys, handler, params)
        )
        if (isStream.readable(result)) {
          return handleStream(result)
        }
        response = [msgType.RESPONSE, msgId, null, result]
      } catch (error) {
        response = [msgType.RESPONSE, msgId, serializeError(error)]
      }
    }
    send(response)

    /** @param {import('stream').Readable} stream */
    function handleStream(stream) {
      // It's intentional that we do not bubble errors here. MessageStream
      // captures any error in `stream` and sends it as a message through the
      // duplex stream
      stream.pipe(new MessageStream(msgId)).pipe(duplex, { end: false })
    }
  }

  /** @param {MsgOn} msg */
  function handleOn(msg) {
    const [, eventName] = msg

    if (!(handler instanceof EventEmitter)) {
      return console.warn(
        'Handler is not an EventEmitter, so it does not support adding listeners. (Subscription from client was ignored)'
      )
    }

    // If we are already emitting for this event, we can ignore
    if (subscriptions.has(eventName)) return

    /** @type {(...args: any[]) => void} */
    const listener = (...args) => {
      if (args.length === 1 && args[0] instanceof Error) {
        send([msgType.EMIT, eventName, serializeError(args[0])])
      } else {
        send([msgType.EMIT, eventName, null, args])
      }
    }
    subscriptions.set(eventName, listener)
    handler.on(eventName, listener)
  }

  /** @param {MsgOff} msg */
  function handleOff(msg) {
    const [, eventName] = msg

    // Fail silently if there is nothing to unsubscribe
    if (!(handler instanceof EventEmitter)) return
    if (!subscriptions.has(eventName)) return

    const listener = subscriptions.get(eventName)
    listener && handler.removeListener(eventName, listener)
    subscriptions.delete(eventName)
  }

  return {
    close: () => {
      duplex.removeListener('data', handleMessage)
      if (!(handler instanceof EventEmitter)) return
      for (const [eventName, listener] of subscriptions.entries()) {
        handler.removeListener(eventName, listener)
        subscriptions = new Map()
      }
    },
  }
}

/**
 * @private
 * Checks if deeply nested property is a function
 *
 * @param {object} target
 * @param {PropertyKey[]} propertyKeys
 * @returns {boolean}
 */
function isFunction(target, propertyKeys) {
  // if (target == null)
  //   throw new TypeError('hasMethodChain() called on non-object')
  try {
    let nested = target
    for (const key of propertyKeys) {
      if (!Reflect.has(nested, key)) return false
      // @ts-ignore
      nested = nested[key]
    }
    return typeof nested === 'function'
  } catch (e) {
    return false
  }
}

/**
 * @private
 * Calls a deeply nested property as a function
 *
 * @param {object} target
 * @param {PropertyKey[]} propertyKeys
 * @param {any} thisArg
 * @param {ArrayLike<any>} args
 * @returns {any}
 */
function applyMethodChain(target, propertyKeys, thisArg, args) {
  let nested = target
  for (const key of propertyKeys) {
    // @ts-ignore
    nested = nested[key]
  }
  return Reflect.apply(/** @type {Function} */ (nested), thisArg, args)
}
