const EventEmitter = require('events').EventEmitter
const assert = require('assert')
const { deserializeError } = require('serialize-error')
const promiseTimeout = require('p-timeout')
const util = require('util')
const isStream = require('is-stream')

const { msgType } = require('./lib/constants')
const isValidMessage = require('./lib/validate-message')

/** @typedef {import("./lib/types").MsgRequest} MsgRequest */
/** @typedef {import("./lib/types").MsgResponse} MsgResponse */
/** @typedef {import("./lib/types").MsgOn} MsgOn */
/** @typedef {import("./lib/types").MsgOff} MsgOff */
/** @typedef {import("./lib/types").MsgEmit} MsgEmit */
/** @typedef {import("./lib/types").Message} Message */

const emitterSubscribeMethods = [
  'addListener',
  'on',
  'prependListener',
  'once',
  'prependOnceListener'
]
const emitterUnsubscribeMethods = ['removeListener', 'off']
const closeProp = Symbol('close')

module.exports = CreateClient

/**
 * @public
 * Create an RPC client that will relay any method that is called via `send`. It
 * listens to replies from the server via `receiver`.
 *
 * @param {import('stream').Duplex} stream Duplex Stream with objectMode=true
 * @param {{timeout?: number}} options Optionally set timeout (default 5000)
 *
 * @returns {import("./lib/types").Client}
 */
function CreateClient (stream, { timeout = 5000 } = {}) {
  assert(isStream.duplex(stream), 'Must pass a duplex stream as first argument')
  let id = 0
  /** @type {Map<number, [(value?: any) => void, (reason?: any) => void]>} */
  const pending = new Map() // Messages pending response
  /** @type {Map<number, Array<Buffer | string | number | boolean | object>>} */
  const collector = new Map() // Streaming responses pending return
  const emitter = new EventEmitter()

  stream.on('data', handleMessage)

  /** @param {MsgRequest | MsgOn | MsgOff} msg */
  function send (msg) {
    // TODO: Do we need back pressure here? Would just result in buffering here
    // vs. buffering in the stream, so probably no
    stream.write(msg)
  }

  /**
   * Handles an incoming message.
   * @param {any} msg Can be any type, but we only process messages types that
   * we understand, other messages are ignored
   */
  function handleMessage (msg) {
    if (Buffer.isBuffer(msg) || typeof msg === 'string') {
      return console.warn(
        'It seems like the stream you are using is not in objectMode (received a message as a Buffer or string). Message was ignored'
      )
    }
    if (!Array.isArray(msg)) {
      return console.warn(`Received invalid message, is something else sending events on the same channel?
Message: ${msg}
(Message was ignored)`)
    }
    switch (msg[0]) {
      case msgType.RESPONSE:
        handleResponse(msg)
        break
      case msgType.EMIT:
        handleEmit(msg)
        break
      default:
        console.warn(
          `Received invalid message type: ${msg[0]}. (Message was ignored)`
        )
    }
  }

  /** @param {any[]} msg */
  function handleResponse (msg) {
    if (!isValidMessage(msg)) return
    const resolveReject = pending.get(msg[1])
    if (!resolveReject) {
      return console.warn(
        `Received unknown message ID: ${msg[1]}. (Message was ignored)`
      )
    }
    const [, msgId, errorObject, value, more] = /** @type {MsgResponse} */ (msg)
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
      const streamedResponse = collector.get(msgId)
      if (streamedResponse) {
        if (value != null) streamedResponse.push(value)
        resolve(concatStreamedResponse(streamedResponse))
        collector.delete(msgId)
      } else {
        resolve(value)
      }
      pending.delete(msgId)
    }
  }

  /** @param {any[]} msg */
  function handleEmit (msg) {
    if (!isValidMessage(msg)) return
    const [, eventName, errorObject, args = []] = /** @type {MsgEmit} */ (msg)
    if (errorObject) {
      Reflect.apply(emitter.emit, emitter, [
        eventName,
        deserializeError(errorObject)
      ])
    } else {
      Reflect.apply(emitter.emit, emitter, [eventName, ...args])
    }
    if (emitter.listenerCount(eventName) === 0) {
      send([msgType.OFF, eventName])
    }
  }

  function handleClose () {
    stream.off('data', handleMessage)
  }

  /** @type {ProxyHandler<any>} */
  const handler = {
    /** @type {(target: any, prop: string | number | symbol, receiver: any) => (...args: any[]) => any} */
    get: (target, prop, receiver) => (...args) => {
      if (prop === closeProp) {
        return handleClose()
      }
      if (prop === util.inspect.custom) {
        return '[RpcReflectorClient]'
      }
      if (typeof prop !== 'string') {
        throw new Error(`ReferenceError: ${String(prop)} is not defined`)
      }
      if (prop in target) {
        if (emitterSubscribeMethods.includes(prop)) {
          Reflect.apply(target[prop], target, args)
          send([msgType.ON, args[0]])
        } else if (emitterUnsubscribeMethods.includes(prop)) {
          Reflect.apply(target[prop], target, args)
          if (emitter.listenerCount(args[0]) === 0) {
            send([msgType.OFF, args[0]])
          }
        } else {
          return Reflect.apply(target[prop], target, args)
        }
        return receiver
      } else {
        const msgId = id++

        const pendingResult = new Promise((resolve, reject) => {
          pending.set(msgId, [resolve, reject])
          send([msgType.REQUEST, msgId, prop, args])
        })

        return promiseTimeout(pendingResult, timeout, function fallback () {
          // Cleanup pending handlers because they will never be called now
          pending.delete(msgId)
          throw new Error(`Server timed out after ${timeout}ms.
            The server could be closed or the transport is down.`)
        })
      }
    }
  }

  const proxy = new Proxy(emitter, handler)

  return proxy
}

/**
 * Close a client. Note this is a static method on `CreateClient` and it expects
 * a client created with `CreateClient` as its argument.
 *
 * @param {any} client A client created with `CreateClient`
 */
CreateClient.close = function close (client) {
  return client[closeProp]()
}

/**
 * A streamedResponse is an array of buffers, strings, or objects. For buffers
 * or strings, concat them all, but anything else returns an array
 *
 * @param {Array<Buffer | string | number | boolean | object>} streamedResponse
 * @returns {Buffer | string | Array<Buffer | string | number | boolean | object>}
 */
function concatStreamedResponse (streamedResponse) {
  let type
  let length = 0
  for (const chunk of streamedResponse) {
    if (Buffer.isBuffer(chunk)) {
      type = !type || type === 'buffer' ? 'buffer' : 'object'
      length += chunk.length
    } else if (typeof chunk === 'string') {
      type = !type || type === 'string' ? 'string' : 'object'
    } else {
      type = 'object'
    }
  }
  switch (type) {
    case 'buffer':
      // @ts-ignore TS doesn't understand the check above
      return Buffer.concat(streamedResponse, length)
    case 'string':
      return streamedResponse.join('')
    default:
      // @ts-ignore TS doesn't understand the check above
      return streamedResponse
  }
}
