import { EventEmitter } from 'eventemitter3'
import { ExhaustivenessError, invariant } from './utils.js'
import { deserializeError } from 'serialize-error'
import promiseTimeout from 'p-timeout'

import { isMessagePortLike } from './is-message-port-like.js'
import { msgType } from './constants.js'
import { stringify, parse } from './prop-array-utils.js'
import { validateResponseMsg } from './validate-message.js'
import nullLogger from 'abstract-logging'
import pDefer from 'p-defer'

/** @import {MessageContainer, MsgRequestObj} from './types.js' */
/** @typedef {import('./types.js').MsgRequest} MsgRequest */
/** @typedef {import('./types.js').MsgResponse} MsgResponse */
/** @typedef {import('./types.js').MsgOn} MsgOn */
/** @typedef {import('./types.js').MsgOff} MsgOff */
/** @typedef {import('./types.js').MsgEmit} MsgEmit */
/** @typedef {import('./types.js').Message} Message */
/** @typedef {import('./types.js').Client} Client */
/** @typedef {import('./types.js').SubClient} SubClient */
/**
 * @template {{}} ApiType
 * @typedef {import('./types.js').ClientApi<ApiType>} ClientApi
 */
/** @typedef {import('./types.js').MessagePortLike} MessagePortLike */
/** @typedef {import('worker_threads').MessagePort} MessagePortNode */

const emitterSubscribeMethods = [
  'addListener',
  'on',
  'prependListener',
  'once',
  'prependOnceListener',
]
const emitterUnsubscribeMethods = ['removeListener', 'off']
const closeProp = Symbol('close')

/**
 * @public
 * @template {{}} ApiType
 * Create an RPC client that will relay any method that is called via `send`. It
 * listens to replies from the server via `receiver`.
 *
 * @param {MessagePort | MessagePortLike | MessagePortNode} channel MessagePort-like object that must implement an `.on('message')` event handler and a `.postMessage()` method.
 * @param {object} [options] Options object
 * @param {number} [options.timeout=5000] Optionally set timeout (default 5000)
 * @param {false | Omit<import('pino').BaseLogger, 'level' | 'silent'>} [options.logger = false] options.logger Set to `false` to disable logging, or pass a pino logger instance to enable logging
 * @param {(request: Omit<MsgRequestObj, 'metadata'>, next: (request: MsgRequestObj) => Promise<any>) => void} [options.onRequestHook] Optional hook to observe and modify a request and its metadata, and to await the response.
 * @returns {ClientApi<ApiType>}
 */
export function createClient(
  channel,
  { timeout = 5000, logger = false, onRequestHook } = {},
) {
  invariant(
    isMessagePortLike(channel),
    'Must pass a browser MessagePort, node worker.MessagePort, or MessagePort-like object',
  )
  const log = logger || nullLogger
  let id = 0
  /** @type {Map<number, [(value?: any) => void, (reason?: any) => void]>} */
  const pending = new Map() // Messages pending response
  /** @type {Map<number, Array<any>>} */
  const collector = new Map() // Streaming responses pending return
  const emitter = new EventEmitter()

  if ('on' in channel) {
    channel.on('message', handleMessage)
  } else {
    /* c8 ignore next 2 - TODO: Add browser tests */
    channel.addEventListener('message', handleMessage)
  }

  /** @param {MsgRequest | MsgOn | MsgOff | MessageContainer} msg */
  function send(msg) {
    channel.postMessage(msg)
  }

  /**
   * @param {MsgRequestObj} request
   * @param {Promise<any>} resultPromise
   */
  function sendRequest({ msgId, method, args }, resultPromise) {
    if (onRequestHook) {
      try {
        onRequestHook({ msgId, method, args }, (modifiedRequest) => {
          sendModifiedRequest(modifiedRequest)
          return resultPromise
        })
      } catch (err) {
        log.error({ err }, 'Error in onRequestHook (ignored)')
        // If the hook throws, we just handle the request directly
        send([msgType.REQUEST, msgId, method, args])
      }
    } else {
      send([msgType.REQUEST, msgId, method, args])
    }
  }

  /**
   * @param {MsgRequestObj} request
   * @returns
   */
  function sendModifiedRequest({ msgId, method, args, metadata }) {
    /** @type {MsgRequest} */
    const msg = [msgType.REQUEST, msgId, method, args]
    if (metadata) {
      send({ value: msg, metadata })
    } else {
      send(msg)
    }
  }

  /**
   * Handles an incoming message.
   * @param {unknown} msg Can be any type, but we only process messages
   * types that we understand, other messages are ignored
   */
  function handleMessage(msg) {
    // When using a MessagePort in a browser or electron environment, the
    // actual data is in `event.data`
    /* c8 ignore next 3 - TODO: Add browser tests */
    if (typeof msg === 'object' && msg && 'data' in msg) {
      msg = msg.data
    }
    try {
      validateResponseMsg(msg)
    } catch (err) {
      log.warn(
        { err, rpcMsg: msg },
        'Received invalid message. (Message was ignored)',
      )
      return
    }
    switch (msg[0]) {
      case msgType.RESPONSE:
        return handleResponse(/** @type {MsgResponse} */ (msg))
      case msgType.EMIT:
        return handleEmit(/** @type {MsgEmit} */ (msg))
      default:
        /* c8 ignore next */
        throw new ExhaustivenessError(msg[0])
    }
  }

  /** @param {MsgResponse} msg */
  function handleResponse([, msgId, errorObject, value, more, objectMode]) {
    const resolveReject = pending.get(msgId)
    if (!resolveReject) {
      log.warn({ msgId }, 'Received unknown message ID (ignored)')
      return
    }
    const [resolve, reject] = resolveReject

    if (errorObject) {
      reject(deserializeError(errorObject))
      pending.delete(msgId)
      collector.delete(msgId)
    } else if (more) {
      // More data coming, so start collecting it.
      // TODO: Support readableStream on client
      const streamedResponse = collector.get(msgId)
      if (streamedResponse) {
        streamedResponse.push(value)
      } else {
        collector.set(msgId, [value])
      }
    } else {
      // Last message in stream
      const streamedResponse = collector.get(msgId)
      if (streamedResponse) {
        /* istanbul ignore if  */
        if (value != null) streamedResponse.push(value)
        // If objectMode stream, return array of chunks from stream
        resolve(
          objectMode
            ? streamedResponse
            : concatStreamedResponse(
                // A non-objectMode stream be either Buffer or string
                /** @type {Buffer[] | string[]} */ (streamedResponse),
              ),
        )
        collector.delete(msgId)
      } else {
        resolve(value)
      }
      pending.delete(msgId)
    }
  }

  /** @param {MsgEmit} msg */
  function handleEmit([, eventName, propArray, errorObject, args = []]) {
    const encodedEventName = stringify(propArray, eventName)
    if (errorObject) {
      Reflect.apply(emitter.emit, emitter, [
        encodedEventName,
        deserializeError(errorObject),
      ])
    } else {
      Reflect.apply(emitter.emit, emitter, [encodedEventName, ...args])
    }
    if (emitter.listenerCount(encodedEventName) === 0) {
      send([msgType.OFF, eventName, propArray])
    }
  }

  function handleClose() {
    if ('off' in channel) {
      channel.off('message', handleMessage)
      /* c8 ignore next 3 - TODO: Add browser tests */
    } else {
      channel.removeEventListener('message', handleMessage)
    }
    // TODO: Should we do this? Or leave it to the user? It's considered "bad
    // practice" to do this
    emitter.removeAllListeners()
  }

  const subClientCache = new Map()

  return createSubClient([], {})

  /**
   * @param {string[]} propArray
   * @param {Function | {}} target
   * @returns {ClientApi<ApiType>} */
  function createSubClient(propArray, target) {
    const cached = subClientCache.get(JSON.stringify(propArray))
    if (cached) return cached

    /** @type {ProxyHandler<any>} */
    const handler = {
      get(target, prop) {
        if (prop === closeProp && propArray.length === 0) {
          return () => handleClose()
        }
        // if (prop === util.inspect.custom) {
        //   // Only Node < 12, not called in browsers
        //   return () => '[rpcProxyClient]'
        // }
        if (typeof prop !== 'string') {
          throw new Error(`ReferenceError: ${String(prop)} is not defined`)
        } else if (prop === 'then') {
          return null
        } else if (prop in EventEmitter.prototype) {
          const eventEmitterProp = /** @type {keyof EventEmitter} */ (prop)
          if (emitterSubscribeMethods.includes(eventEmitterProp)) {
            return /** @type {(...args: any[]) => Client} */ (...args) => {
              const originalEventName = args[0]
              args[0] = stringify(propArray, originalEventName)
              Reflect.apply(emitter[eventEmitterProp], emitter, args)
              send([msgType.ON, originalEventName, propArray])
              return proxy
            }
          } else if (emitterUnsubscribeMethods.includes(eventEmitterProp)) {
            return /** @type {(...args: any[]) => Client} */ (...args) => {
              const originalEventName = args[0]
              args[0] = stringify(propArray, originalEventName)
              Reflect.apply(emitter[eventEmitterProp], emitter, args)
              if (emitter.listenerCount(args[0]) === 0) {
                send([msgType.OFF, originalEventName, propArray])
              }
              return proxy
            }
          } else if (eventEmitterProp === 'eventNames') {
            return /** @type {(...args: any[]) => string[]} */ (...args) => {
              /** @type {string[]} */
              const eventNames = Reflect.apply(
                emitter[eventEmitterProp],
                emitter,
                args,
              )
              return eventNames.reduce((acc, encodedEventName) => {
                const [eventPropArray, eventName] = parse(encodedEventName)
                if (isStringArrayEqual(eventPropArray, propArray)) {
                  acc.push(eventName)
                }
                return acc
              }, /** @type {string[]} **/ ([]))
            }
          } else {
            return /** @type {(...args: any[]) => Client} */ (...args) => {
              // TODO: These methods will not return expected results due to the
              // overloading of the single event emitter to emulate multiple
              return Reflect.apply(emitter[eventEmitterProp], emitter, args)
            }
          }
        }
        return createSubClient(propArray.concat(prop), () => {})
      },
      getPrototypeOf() {
        return EventEmitter.prototype
      },
      apply(target, thisArg, args) {
        // We never hit this code path because the initial proxy targets an
        // empty object, which will throw if you try to call it, but adding this
        // to make TypeScript happy and convince TS that propArray is a
        // non-empty array
        /* c8 ignore next 3 */
        if (!isNonEmptyStringArray(propArray)) {
          throw new TypeError('[target] is not a function')
        }
        const msgId = id++

        const { resolve, reject, promise } = pDefer()
        pending.set(msgId, [resolve, reject])
        const resultPromiseWithTimeout = promiseTimeout(promise, {
          milliseconds: timeout,
          fallback() {
            // Cleanup pending handlers because they will never be called now
            pending.delete(msgId)
            throw new Error(`Server timed out after ${timeout}ms.
            The server could be closed or the transport is down.`)
          },
        })
        sendRequest(
          { msgId, method: propArray, args },
          resultPromiseWithTimeout,
        )
        return resultPromiseWithTimeout
      },
    }

    const proxy = new Proxy(target, handler)

    if (propArray.length > 0) {
      // In some ways this is a memory leak, but only if a client tries to
      // access large numbers of methods. If the client respects the client
      // type, then this is just lazily creating the API object referenced on
      // the server.
      subClientCache.set(JSON.stringify(propArray), proxy)
    }

    return proxy
  }
}

/**
 * Close a client. Note this is a static method on `createClient` and it expects
 * a client created with `createClient` as its argument.
 *
 * @param {any} client A client created with `createClient`
 */
createClient.close = function close(client) {
  return client[closeProp]()
}

/**
 * For non-objectMode streams we receive the response as either Buffer or
 * strings (Node also supports Uint8Arrays in streams, but message-stream will
 * always convert these to buffers)
 *
 * @param {Buffer[] | string[]} streamedResponse
 * @returns {Buffer | string}
 */
function concatStreamedResponse(streamedResponse) {
  if (typeof streamedResponse[0] === 'string') {
    return /** @type {string[]} */ (streamedResponse).join('')
  }
  return Buffer.concat(/** @type {Buffer[]} */ (streamedResponse))
}

/**
 * @param {string[]} arr
 * @returns {arr is import('./types.js').NonEmptyArray<string>}
 */
function isNonEmptyStringArray(arr) {
  return arr.length > 0
}

/**
 * Compare two arrays of strings to see if they are "deeply" equal
 *
 * @param {string[]} arr1
 * @param {string[]} arr2
 * @returns {boolean}
 */
function isStringArrayEqual(arr1, arr2) {
  if (arr1.length !== arr2.length) return false
  for (const [index, item] of arr1.entries()) {
    if (item !== arr2[index]) return false
  }
  return true
}
