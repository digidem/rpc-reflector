import { ExhaustivenessError, invariant } from './utils.js'
import { serializeError } from 'serialize-error'
import nullLogger from 'abstract-logging'
import { isDuplexStream, isReadableStream } from 'is-stream'
import { msgType } from './constants.js'
import { validateMetadata, validateRequestMsg } from './validate-message.js'
import { parse, stringify } from './prop-array-utils.js'
import { MessageStream } from './message-stream.js'
import { isMessagePortLike } from './is-message-port-like.js'
import { EventEmitter } from 'events'
import ensureError from 'ensure-error'

/** @import {MsgRequestObj, Result, Metadata, MsgId} from './types.js'*/
/** @typedef {import('./types.js').MsgRequest} MsgRequest */
/** @typedef {import('./types.js').MsgResponse} MsgResponse */
/** @typedef {import('./types.js').MsgOn} MsgOn */
/** @typedef {import('./types.js').MsgOff} MsgOff */
/** @typedef {import('./types.js').MsgEmit} MsgEmit */
/** @typedef {import('./types.js').Message} Message */
/** @typedef {import('./types.js').NonEmptyArray<string>} NonEmptyStringArray */
/** @typedef {import('./types.js').MessagePortLike} MessagePortLike */
/** @typedef {import('worker_threads').MessagePort} MessagePortNode */

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
 * @param {object} [options] Options object
 * @param {false | Omit<import('pino').BaseLogger, 'level' | 'silent'>} [options.logger = false] options.logger Set to `false` to disable logging, or pass a pino logger instance to enable logging
 * @param {(request: MsgRequestObj, next: (request: Omit<MsgRequestObj, 'metadata'>) => Result) => void} [options.onRequestHook] Optional hook to observe and modify a request and its metadata, and to await the response.
 * @returns {{ close: () => void }} An object with a single method `close()` that will stop the server listening to and sending any more messages
 */
export function createServer(
  handler,
  channel,
  { logger = false, onRequestHook } = {},
) {
  invariant(typeof handler === 'object', 'Missing handler object.')
  const log = logger || nullLogger
  const channelIsStream = isDuplexStream(channel)
  invariant(
    isMessagePortLike(channel) || channelIsStream,
    'Must pass a Duplex Stream or a browser MessagePort, node worker.MessagePort, or MessagePort-like object',
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
   * @param {unknown} messageContainer Can be any type, but we only process messages types that
   * we understand, other messages are ignored
   */
  function handleMessage(messageContainer) {
    /** @type {unknown} */
    let msg
    /** @type {Metadata | undefined} */
    let metadata

    // When using a MessagePort in a browser or electron environment, the
    // actual data is in `event.data`
    if (
      typeof messageContainer === 'object' &&
      messageContainer &&
      'data' in messageContainer
    ) {
      messageContainer = messageContainer.data
    }

    // If the message is a MessageContainer, we extract the value and metadata
    if (Array.isArray(messageContainer)) {
      msg = messageContainer
    } else if (
      typeof messageContainer === 'object' &&
      messageContainer !== null
    ) {
      if ('value' in messageContainer) {
        msg = messageContainer.value
      }
      if (
        'metadata' in messageContainer &&
        messageContainer.metadata !== undefined
      ) {
        try {
          validateMetadata(messageContainer.metadata)
          metadata = messageContainer.metadata
        } catch (err) {
          log.warn(
            { err, rpcMetadata: messageContainer.metadata },
            'Invalid RPC metadata received (ignored)',
          )
        }
      }
    }
    try {
      validateRequestMsg(msg)
    } catch (err) {
      log.warn({ err, rpcMsg: msg }, 'Invalid RPC message received (ignored)')
      return
    }

    switch (msg[0]) {
      case msgType.REQUEST:
        {
          const request = {
            msgId: msg[1],
            method: msg[2],
            args: msg[3],
            metadata,
          }
          if (onRequestHook) {
            try {
              onRequestHook(request, handleRequest)
            } catch (err) {
              log.error({ err, request }, 'Error in onRequestHook (ignored)')
              // If the hook throws, we just handle the request directly
              handleRequest(request)
            }
          } else {
            handleRequest(request)
          }
        }
        break
      case msgType.ON:
        handleOn(msg)
        break
      case msgType.OFF:
        handleOff(msg)
        break
      default:
        throw new ExhaustivenessError(msg[0])
    }
  }

  /**
   * @param {MsgRequestObj} request
   * @returns {Result}
   */
  function handleRequest({ msgId, method, args }) {
    let syncResult
    try {
      syncResult = applyNestedMethod(handler, method, args)
    } catch (error) {
      send([msgType.RESPONSE, msgId, serializeError(ensureError(error))])
      const resultPromise = Promise.reject(error)
      resultPromise.catch(noop)
      return resultPromise
    }

    if (isReadableStream(syncResult)) {
      handleStream(msgId, syncResult)
      return syncResult
    }

    // This is done with Promise.then rather than an async function so that we
    // can synchronously return a stream (above).
    const resultPromise = Promise.resolve(syncResult).then((result) => {
      if (isReadableStream(result)) {
        handleStream(msgId, result)
        return result
      }
      send([msgType.RESPONSE, msgId, null, result])
      return result
    })

    // resultPromise itself should be returned uncaught, so that the
    // onRequestHook can observe the error. Having the catch here avoids an
    // uncaught error if the onRequestHook does not attach a catch handler.
    resultPromise.catch((error) => {
      send([msgType.RESPONSE, msgId, serializeError(ensureError(error))])
    })

    return resultPromise
  }

  /**
   * @param {MsgId} msgId
   * @param {import('stream').Readable} stream
   */
  function handleStream(msgId, stream) {
    const rs = stream.pipe(new MessageStream(msgId))
    if (channelIsStream) {
      rs.pipe(channel, { end: false })
    } else {
      rs.on('data', (chunk) => send(chunk))
    }
    rs.on('error', (err) =>
      send([msgType.RESPONSE, msgId, serializeError(err)]),
    )
  }

  /** @param {MsgOn} msg */
  function handleOn([, eventName, propArray]) {
    let emitter
    try {
      emitter = getNestedEventEmitter(handler, propArray)
    } catch (err) {
      log.warn(
        { err, eventName, propArray },
        'Error subscribing to event (ignored)',
      )
      return
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
    } catch (err) {
      log.warn(
        { err, eventName, propArray },
        'Error unsubscribing from event (ignored)',
      )
      return
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
        } catch {
          // No-op if error removing event listener
        }
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
      } is not an EventEmitter`,
    )
  }
  return nested
}
function noop() {}
