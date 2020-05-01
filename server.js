const EventEmitter = require('events').EventEmitter
const assert = require('assert')
const { serializeError } = require('serialize-error')
const isStream = require('is-stream')

const { msgType } = require('./lib/constants')
const isValidMessage = require('./lib/validate-message')
const {
  parse,
  stringify,
  getMethodString,
} = require('./lib/method-chain-utils')
const MessageStream = require('./lib/message-stream')

/** @typedef {import('./lib/types').MsgRequest} MsgRequest */
/** @typedef {import('./lib/types').MsgResponse} MsgResponse */
/** @typedef {import('./lib/types').MsgOn} MsgOn */
/** @typedef {import('./lib/types').MsgOff} MsgOff */
/** @typedef {import('./lib/types').MsgEmit} MsgEmit */
/** @typedef {import('./lib/types').Message} Message */
/** @typedef {import('./lib/types').MethodChain} MethodChain */

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
  async function handleRequest([, msgId, methodChain]) {
    /** @type {MsgResponse} */
    let response

    try {
      const result = await Promise.resolve(
        applyMethodChain(handler, methodChain)
      )
      if (isStream.readable(result)) {
        return handleStream(result)
      }
      response = [msgType.RESPONSE, msgId, null, result]
    } catch (error) {
      response = [msgType.RESPONSE, msgId, serializeError(error)]
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
  function handleOn([, eventName, methodChain]) {
    const method = getMethod(handler, methodChain)
    if (!(method instanceof EventEmitter)) {
      return console.warn(
        `${getMethodString(
          methodChain
        )} is not an EventEmitter, so it does not support adding listeners. (Subscription from client was ignored)`
      )
    }
    const encodedEventName = stringify(methodChain, eventName)

    // If we are already emitting for this event, we can ignore
    if (subscriptions.has(encodedEventName)) return

    /** @type {(...args: any[]) => void} */
    const listener = (...args) => {
      if (args.length === 1 && args[0] instanceof Error) {
        send([msgType.EMIT, eventName, methodChain, serializeError(args[0])])
      } else {
        send([msgType.EMIT, eventName, methodChain, null, args])
      }
    }
    subscriptions.set(encodedEventName, listener)
    method.on(eventName, listener)
  }

  /** @param {MsgOff} msg */
  function handleOff([, eventName, methodChain]) {
    const method = getMethod(handler, methodChain)
    if (!(method instanceof EventEmitter)) {
      return console.warn(
        `${getMethodString(
          methodChain
        )} is not an EventEmitter, so it does not support adding listeners. (Subscription from client was ignored)`
      )
    }
    const encodedEventName = stringify(methodChain, eventName)

    // Fail silently if there is nothing to unsubscribe
    if (!subscriptions.has(encodedEventName)) return

    const listener = subscriptions.get(encodedEventName)
    listener && method.removeListener(eventName, listener)
    subscriptions.delete(encodedEventName)
  }

  return {
    close: () => {
      duplex.removeListener('data', handleMessage)
      for (const [encodedEventName, listener] of subscriptions.entries()) {
        const [methodChain, eventName] = parse(encodedEventName)
        const method = getMethod(handler, methodChain)
        method && method.removeListener(eventName, listener)
      }
      subscriptions = new Map()
    },
  }
}

/**
 * @private
 * Calls a deeply nested property function. Throws a TypeError if not a function
 *
 * @param {{[propertyKey: string]: any}} target
 * @param {MethodChain} methodChain
 * @returns {any}
 */
function applyMethodChain(target, methodChain) {
  try {
    let nested = target
    for (const [propertyKey, args] of methodChain.slice(0, -1)) {
      if (!Reflect.has(nested, propertyKey)) {
        throw new TypeError('is not a function')
      }
      if (args) {
        if (typeof nested[propertyKey] !== 'function') {
          throw new TypeError('is not a function')
        }
        nested = Reflect.apply(nested[propertyKey], nested, args)
      }
      nested = nested[propertyKey]
    }
    const [propertyKey, args = []] = methodChain[methodChain.length - 1]
    return Reflect.apply(nested[propertyKey], nested, args)
  } catch (e) {
    if (e instanceof TypeError && e.message.includes('not a function')) {
      throw new TypeError(`${getMethodString(methodChain)} is not a function`)
    } else {
      throw e
    }
  }
}

/**
 * @private
 * Returns a deeply nested property
 *
 * @param {{[propertyKey: string]: any}} target
 * @param {MethodChain} methodChain
 * @returns {any}
 */
function getMethod(target, methodChain) {
  if (methodChain.length === 0) return target
  try {
    let nested = target
    for (const [propertyKey, args] of methodChain) {
      if (!Reflect.has(nested, propertyKey)) {
        throw new TypeError('is not a function')
      }
      if (args) {
        nested = Reflect.apply(nested[propertyKey], nested, args)
      } else {
        nested = nested[propertyKey]
      }
    }
    return nested
  } catch (e) {}
}
