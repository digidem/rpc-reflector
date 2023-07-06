const { invariant } = require('./lib/invariant')
const { serializeError } = require('serialize-error')

const isStream = require('is-stream')
const { msgType } = require('./lib/constants')
const isValidMessage = require('./lib/validate-message')
const { parse, stringify } = require('./lib/prop-array-utils')
const MessageStream = require('./lib/message-stream')
const isMessagePortLike = require('./lib/is-message-port-like')
const { EventEmitter } = require('events')

/** @typedef {import('./lib/types').MsgRequest} MsgRequest */
/** @typedef {import('./lib/types').MsgResponse} MsgResponse */
/** @typedef {import('./lib/types').MsgOn} MsgOn */
/** @typedef {import('./lib/types').MsgOff} MsgOff */
/** @typedef {import('./lib/types').MsgEmit} MsgEmit */
/** @typedef {import('./lib/types').Message} Message */
/** @typedef {import('./lib/types').NonEmptyArray<string>} NonEmptyStringArray */
/** @typedef {import('./lib/types').MessagePortLike} MessagePortLike */
/** @typedef {import('worker_threads').MessagePort} MessagePortNode */

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
 * @param {MessagePort | MessagePortLike | MessagePortNode | import('stream').Duplex} channel A Duplex Stream with objectMode=true or a MessagePort-like object that must implement an `.on('message')` event handler and a `.postMessage()` method.
 *
 * @returns {{ close: () => void }} An object with a single method `close()`
 * that will stop the server listening to and sending any more messages
 */
function createServer(handler, channel) {
  invariant(typeof handler === 'object', 'Missing handler object.')
  const channelIsStream = isStream.duplex(channel)
  invariant(
    isMessagePortLike(channel) || channelIsStream,
    'Must pass a Duplex Stream or a browser MessagePort, node worker.MessagePort, or MessagePort-like object'
  )

  /** @type {Map<string, (...args: any[]) => void>} */
  let subscriptions = new Map()

  if (channelIsStream) {
    channel.on('data', handleMessage)
  } else if ('on' in channel) {
    channel.on('message', handleMessage)
  } else {
    channel.addEventListener('message', handleMessage)
  }

  /** @param {MsgResponse | MsgEmit} msg */
  function send(msg) {
    // TODO: Do we need back pressure here? Would just result in buffering here
    // vs. buffering in the stream, so probably no
    if (channelIsStream) {
      channel.write(msg)
    } else {
      channel.postMessage(msg)
    }
  }

  /**
   * Handles an incoming message.
   * @param {unknown} msg Can be any type, but we only process messages types that
   * we understand, other messages are ignored
   */
  function handleMessage(msg) {
    // When using a MessagePort in a browser or electron environment, the
    // actual data is in `event.data`
    if (typeof msg === 'object' && msg && 'data' in msg) {
      msg = msg.data
    }
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
  async function handleRequest([, msgId, propArray, args]) {
    /** @type {MsgResponse} */
    let response

    try {
      const result = await Promise.resolve(
        applyNestedMethod(handler, propArray, args)
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
      const rs = stream.pipe(new MessageStream(msgId))
      if (channelIsStream) {
        rs.pipe(channel, { end: false })
      } else {
        rs.on('data', (chunk) => send(chunk))
      }
      rs.on('error', (err) =>
        send([msgType.RESPONSE, msgId, serializeError(err)])
      )
    }
  }

  /** @param {MsgOn} msg */
  function handleOn([, eventName, propArray]) {
    let emitter
    try {
      emitter = getNestedEventEmitter(handler, propArray)
    } catch (e) {
      return console.warn(e + '. (Subscription from client was ignored)')
    }

    const encodedEventName = stringify(propArray, eventName)

    // If we are already emitting for this event, we can ignore
    if (subscriptions.has(encodedEventName)) return

    /** @type {(...args: any[]) => void} */
    const listener = (...args) => {
      if (args.length === 1 && args[0] instanceof Error) {
        send([msgType.EMIT, eventName, propArray, serializeError(args[0])])
      } else {
        send([msgType.EMIT, eventName, propArray, null, args])
      }
    }
    subscriptions.set(encodedEventName, listener)
    emitter.on(eventName, listener)
  }

  /** @param {MsgOff} msg */
  function handleOff([, eventName, propArray]) {
    let emitter
    try {
      emitter = getNestedEventEmitter(handler, propArray)
    } catch (e) {
      return console.warn(e + '. (Subscription from client was ignored)')
    }

    const encodedEventName = stringify(propArray, eventName)

    // Fail silently if there is nothing to unsubscribe
    if (!subscriptions.has(encodedEventName)) return

    const listener = subscriptions.get(encodedEventName)
    listener && emitter.removeListener(eventName, listener)
    subscriptions.delete(encodedEventName)
  }

  return {
    close: () => {
      if (channelIsStream) {
        channel.off('data', handleMessage)
      } else if ('off' in channel) {
        channel.off('message', handleMessage)
      } else {
        channel.removeEventListener('message', handleMessage)
      }
      for (const [encodedEventName, listener] of subscriptions.entries()) {
        const [propArray, eventName] = parse(encodedEventName)
        try {
          const emitter = getNestedEventEmitter(handler, propArray)
          emitter.removeListener(eventName, listener)
        } catch (e) {}
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
 * @param {NonEmptyStringArray} propArray
 * @param {ArrayLike<any>} args
 * @returns {any}
 */
function applyNestedMethod(target, propArray, args) {
  let nested = target
  for (const propertyKey of propArray.slice(0, -1)) {
    if (!Reflect.has(nested, propertyKey)) {
      throw new ReferenceError(`${propertyKey} is not defined`)
    }
    nested = nested[propertyKey]
  }
  const propertyKey = propArray[propArray.length - 1]
  if (nested === null) {
    throw new TypeError(`Cannot read property '${propertyKey}' of null`)
  }
  if (typeof nested === 'object') {
    if (!Reflect.has(nested, propertyKey)) {
      throw new ReferenceError(`${propertyKey} is not defined`)
    }
  } else if (typeof nested[propertyKey] === 'undefined') {
    throw new ReferenceError(`${propertyKey} is not defined`)
  }
  if (typeof nested[propertyKey] === 'function') {
    return Reflect.apply(nested[propertyKey], nested, args)
  }
  if (typeof nested[propertyKey] === 'symbol') {
    throw new TypeError(`Property '${propertyKey}' is a Symbol`)
  }
  return nested[propertyKey]
}

/**
 * @private
 * Returns a deeply nested event emitter
 *
 * @param {{[propertyKey: string]: any}} target
 * @param {string[]} propArray
 * @returns {EventEmitter}
 */
function getNestedEventEmitter(target, propArray) {
  let nested = target
  for (const propertyKey of propArray) {
    if (!Reflect.has(nested, propertyKey)) {
      throw new ReferenceError(`${propertyKey} is not defined`)
    }
    nested = nested[propertyKey]
  }
  if (!(nested instanceof EventEmitter)) {
    throw new TypeError(
      `${
        propArray.length === 0 ? '[target]' : propArray[propArray.length - 1]
      } is not an EventEmitter`
    )
  }
  return nested
}
