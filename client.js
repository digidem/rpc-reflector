const { EventEmitter } = require('eventemitter3')
const { invariant } = require('./lib/invariant')
const { deserializeError } = require('serialize-error')
const promiseTimeout = require('p-timeout')
const isStream = require('is-stream')

const isMessagePortLike = require('./lib/is-message-port-like')
const { msgType } = require('./lib/constants')
const { stringify, parse } = require('./lib/prop-array-utils')
const isValidMessage = require('./lib/validate-message')

/** @typedef {import('./lib/types').MsgRequest} MsgRequest */
/** @typedef {import('./lib/types').MsgResponse} MsgResponse */
/** @typedef {import('./lib/types').MsgOn} MsgOn */
/** @typedef {import('./lib/types').MsgOff} MsgOff */
/** @typedef {import('./lib/types').MsgEmit} MsgEmit */
/** @typedef {import('./lib/types').Message} Message */
/** @typedef {import('./lib/types').Client} Client */
/** @typedef {import('./lib/types').SubClient} SubClient */
/**
 * @template {{}} ApiType
 * @typedef {import('./lib/types').ClientApi<ApiType>} ClientApi
 */
/** @typedef {import('./lib/types').MessagePortLike} MessagePortLike */
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

module.exports = createClient

/**
 * @public
 * @template {{}} ApiType
 * Create an RPC client that will relay any method that is called via `send`. It
 * listens to replies from the server via `receiver`.
 *
 * @param {MessagePort | MessagePortLike | MessagePortNode | import('stream').Duplex} channel A Duplex Stream with objectMode=true or a MessagePort-like object that must implement an `.on('message')` event handler and a `.postMessage()` method.
 * @param {{timeout?: number}} options Optionally set timeout (default 5000)
 *
 * @returns {ClientApi<ApiType>}
 */
function createClient(channel, { timeout = 5000 } = {}) {
  const channelIsStream = isStream.duplex(channel)
  invariant(
    isMessagePortLike(channel) || channelIsStream,
    'Must pass a Duplex Stream or a browser MessagePort, node worker.MessagePort, or MessagePort-like object'
  )
  let id = 0
  /** @type {Map<number, [(value?: any) => void, (reason?: any) => void]>} */
  const pending = new Map() // Messages pending response
  /** @type {Map<number, Array<any>>} */
  const collector = new Map() // Streaming responses pending return
  const emitter = new EventEmitter()

  if (channelIsStream) {
    channel.on('data', handleMessage)
  } else if ('on' in channel) {
    channel.on('message', handleMessage)
  } else {
    channel.addEventListener('message', handleMessage)
  }

  /** @param {MsgRequest | MsgOn | MsgOff} msg */
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
   * @param {unknown} msg Can be any type, but we only process messages
   * types that we understand, other messages are ignored
   */
  function handleMessage(msg) {
    // When using a MessagePort in a browser or electron environment, the
    // actual data is in `event.data`
    if (typeof msg === 'object' && msg && 'data' in msg) {
      msg = msg.data
    }
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
    if (channelIsStream) {
      channel.off('data', handleMessage)
    } else if ('off' in channel) {
      channel.off('message', handleMessage)
    } else {
      channel.removeEventListener('message', handleMessage)
    }
    // TODO: Should we do this? Or leave it to the user? It's considered "bad
    // practice" to do this
    emitter.removeAllListeners()
  }

  return createSubClient([], {})

  /**
   * @param {string[]} propArray
   * @param {Function | {}} target
   * @returns {ClientApi<ApiType>} */
  function createSubClient(propArray, target) {
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
                args
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
        /* istanbul ignore if  */
        if (!isNonEmptyStringArray(propArray)) {
          throw new TypeError('[target] is not a function')
        }
        const msgId = id++

        const pendingResult = new Promise((resolve, reject) => {
          pending.set(msgId, [resolve, reject])
          send([msgType.REQUEST, msgId, propArray, args])
        })

        return promiseTimeout(pendingResult, timeout, function fallback() {
          // Cleanup pending handlers because they will never be called now
          pending.delete(msgId)
          throw new Error(`Server timed out after ${timeout}ms.
            The server could be closed or the transport is down.`)
        })
      },
    }

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
