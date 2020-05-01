const EventEmitter = require('events').EventEmitter
const assert = require('assert')
const { deserializeError } = require('serialize-error')
const promiseTimeout = require('p-timeout')
const util = require('util')
const isStream = require('is-stream')

const { msgType } = require('./lib/constants')
const { stringify, parse } = require('./lib/method-chain-utils')
const isValidMessage = require('./lib/validate-message')

/** @typedef {import('./lib/types').MsgRequest} MsgRequest */
/** @typedef {import('./lib/types').MsgResponse} MsgResponse */
/** @typedef {import('./lib/types').MsgOn} MsgOn */
/** @typedef {import('./lib/types').MsgOff} MsgOff */
/** @typedef {import('./lib/types').MsgEmit} MsgEmit */
/** @typedef {import('./lib/types').Message} Message */
/** @typedef {import('./lib/types').Client} Client */
/** @typedef {import('./lib/types').SubClient} SubClient */
/** @typedef {import('./lib/types').MethodChain} MethodChain */
/** @typedef {(...args: any[]) => Client} GetMethodTrap */

const emitterSubscribeMethods = [
  'addListener',
  'on',
  'prependListener',
  'once',
  'prependOnceListener',
]
const emitterUnsubscribeMethods = ['removeListener', 'off']
const closeProp = Symbol('close')

module.exports = createClient

/**
 * @public
 * Create an RPC client that will relay any method that is called via `send`. It
 * listens to replies from the server via `receiver`.
 *
 * @param {import('stream').Duplex} stream Duplex Stream with objectMode=true
 * @param {{timeout?: number}} options Optionally set timeout (default 5000)
 *
 * @returns {Client}
 */
function createClient(stream, { timeout = 5000 } = {}) {
  assert(isStream.duplex(stream), 'Must pass a duplex stream as first argument')
  let id = 0
  /** @type {Map<number, [(value?: any) => void, (reason?: any) => void]>} */
  const pending = new Map() // Messages pending response
  /** @type {Map<number, Array<any>>} */
  const collector = new Map() // Streaming responses pending return
  const emitter = new EventEmitter()

  stream.on('data', handleMessage)

  /** @param {MsgRequest | MsgOn | MsgOff} msg */
  function send(msg) {
    // TODO: Do we need back pressure here? Would just result in buffering here
    // vs. buffering in the stream, so probably no
    stream.write(msg)
  }

  /**
   * Handles an incoming message.
   * @param {any} msg Can be any type, but we only process messages
   * types that we understand, other messages are ignored
   */
  function handleMessage(msg) {
    if (!isValidMessage(msg)) return
    switch (msg[0]) {
      case msgType.RESPONSE:
        return handleResponse(/** @type {MsgResponse} */ (msg))
      case msgType.EMIT:
        return handleEmit(/** @type {MsgEmit} */ (msg))
      default:
        console.warn(
          `Received unexpected message type: ${msg[0]}. (Message was ignored)`
        )
    }
  }

  /** @param {MsgResponse} msg */
  function handleResponse([, msgId, errorObject, value, more, objectMode]) {
    const resolveReject = pending.get(msgId)
    if (!resolveReject) {
      return console.warn(
        `Received unknown message ID: ${msgId}. (Message was ignored)`
      )
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
                /** @type {Buffer[] | string[]} */ (streamedResponse)
              )
        )
        collector.delete(msgId)
      } else {
        resolve(value)
      }
      pending.delete(msgId)
    }
  }

  /** @param {MsgEmit} msg */
  function handleEmit([, eventName, methodChain, errorObject, args = []]) {
    const encodedEventName = stringify(methodChain, eventName)
    if (errorObject) {
      Reflect.apply(emitter.emit, emitter, [
        encodedEventName,
        deserializeError(errorObject),
      ])
    } else {
      Reflect.apply(emitter.emit, emitter, [encodedEventName, ...args])
    }
    if (emitter.listenerCount(encodedEventName) === 0) {
      send([msgType.OFF, eventName, methodChain])
    }
  }

  function handleClose() {
    stream.off('data', handleMessage)
    // TODO: Should we do this? Or leave it to the user? It's considered "bad
    // practice" to do this
    emitter.removeAllListeners()
  }

  return createSubClient([])

  /**
   * @param {MethodChain} methodChain
   * @param {Promise<any> | Function} [target]
   * @returns {Client  | SubClient} */
  function createSubClient(methodChain, target = () => {}) {
    /** @type {ProxyHandler<any>} */
    const handler = {
      get(target, prop) {
        if (prop === closeProp && methodChain.length === 0) {
          return () => handleClose()
        }
        /* istanbul ignore if  */
        if (prop === util.inspect.custom) {
          // Only Node < 12, not called in browsers
          return () => '[rpcProxyClient]'
        }
        if (typeof prop !== 'string') {
          throw new Error(`ReferenceError: ${String(prop)} is not defined`)
        }
        if (prop in target) {
          const targetAsPromise = /** @type {Promise<any>} */ (target)
          const promiseProp = /** @type {keyof Promise<any>} */ (prop)
          return /** @type {(...args: any[]) => Client} */ (...args) => {
            return createSubClient(
              methodChain,
              Reflect.apply(targetAsPromise[promiseProp], target, args)
            )
          }
        } else if (prop in EventEmitter.prototype) {
          const eventEmitterProp = /** @type {keyof EventEmitter} */ (prop)
          if (emitterSubscribeMethods.includes(prop)) {
            return /** @type {(...args: any[]) => Client} */ (...args) => {
              const originalEventName = args[0]
              args[0] = stringify(methodChain, originalEventName)
              Reflect.apply(emitter[eventEmitterProp], emitter, args)
              send([msgType.ON, originalEventName, methodChain])
              return proxy
            }
          } else if (emitterUnsubscribeMethods.includes(prop)) {
            return /** @type {(...args: any[]) => Client} */ (...args) => {
              const originalEventName = args[0]
              args[0] = stringify(methodChain, originalEventName)
              Reflect.apply(emitter[eventEmitterProp], emitter, args)
              if (emitter.listenerCount(args[0]) === 0) {
                send([msgType.OFF, originalEventName, methodChain])
              }
              return proxy
            }
          } else if (prop === 'eventNames') {
            return /** @type {(...args: any[]) => string[]} */ (...args) => {
              /** @type {string[]} */
              const eventNames = Reflect.apply(
                emitter[eventEmitterProp],
                emitter,
                args
              )
              return eventNames.reduce((acc, encodedEventName) => {
                const [eventMethodChain, eventName] = parse(encodedEventName)
                if (util.isDeepStrictEqual(eventMethodChain, methodChain))
                  acc.push(eventName)
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
        return createSubClient(methodChain.concat([[prop]]))
      },
      getPrototypeOf() {
        return EventEmitter.prototype
      },
    }

    const lastInChain = methodChain[methodChain.length - 1]
    if (lastInChain && !Array.isArray(lastInChain[1])) {
      handler.apply = function apply(target, thisArg, args) {
        const prop = lastInChain[0]
        const newMethodChain = methodChain.slice(0, -1)
        newMethodChain.push([lastInChain[0], args])
        const msgId = id++

        const pendingResult = new Promise((resolve, reject) => {
          pending.set(msgId, [resolve, reject])
          send([msgType.REQUEST, msgId, newMethodChain])
        })

        return createSubClient(
          newMethodChain,
          promiseTimeout(pendingResult, timeout, function fallback() {
            // Cleanup pending handlers because they will never be called now
            pending.delete(msgId)
            throw new Error(`Server timed out after ${timeout}ms.
            The server could be closed or the transport is down.`)
          })
        )
      }
    }

    /** @type {Client | SubClient} */
    const proxy = new Proxy(target, handler)

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
 * @returns {arr is import('./lib/types').NonEmptyArray<string>}
 */
function isNonEmptyStringArray(arr) {
  return arr.length > 0
}
