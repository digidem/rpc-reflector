const EventEmitter = require('events').EventEmitter
const assert = require('assert')
const { serializeError } = require('serialize-error')
const isStream = require('is-stream')

const { msgType } = require('./lib/constants')
const isValidMessage = require('./lib/validate-message')
const MessageStream = require('./lib/message-stream')

/** @typedef {import("./lib/types").MsgRequest} MsgRequest */
/** @typedef {import("./lib/types").MsgResponse} MsgResponse */
/** @typedef {import("./lib/types").MsgOn} MsgOn */
/** @typedef {import("./lib/types").MsgOff} MsgOff */
/** @typedef {import("./lib/types").MsgEmit} MsgEmit */
/** @typedef {import("./lib/types").Message} Message */

module.exports = CreateServer

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
function CreateServer (handler, duplex) {
  assert(typeof handler === 'object', 'Missing handler object.')
  assert(isStream.duplex(duplex), 'Must pass a duplex stream as first argument')

  /** @type {Map<string, (...args: any[]) => void>} */
  let subscriptions = new Map()

  duplex.on('data', handleMessage)

  /** @param {MsgResponse | MsgEmit} msg */
  function send (msg) {
    // TODO: Do we need back pressure here? Would just result in buffering here
    // vs. buffering in the stream, so probably no
    duplex.write(msg)
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
      case msgType.REQUEST:
        handleRequest(msg)
        break
      case msgType.ON:
        handleOn(msg)
        break
      case msgType.OFF:
        handleOff(msg)
        break
      default:
        console.warn(`Unhandled message type: ${msg[0]}. (Message was ignored)`)
    }
  }

  /** @param {any[]} msg */
  async function handleRequest (msg) {
    if (!isValidMessage(msg)) return

    const [, msgId, method, params] = /** @type {MsgRequest} */ (msg)
    /** @type {MsgResponse} */
    let response

    if (!Reflect.has(handler, method)) {
      const error = new Error('Method not supported')
      response = [msgType.RESPONSE, msgId, serializeError(error)]
    } else {
      try {
        const result = await Promise.resolve(
          Reflect.apply(handler[method], handler, params)
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
    function handleStream (stream) {
      // It's intentional that we do not bubble errors here. MessageStream
      // captures any error in `stream` and sends it as a message through the
      // duplex stream
      stream.pipe(new MessageStream(msgId)).pipe(duplex, { end: false })
    }
  }

  /** @param {any[]} msg */
  function handleOn (msg) {
    if (!isValidMessage(msg)) return

    const [, eventName] = /** @type {MsgOn} */ (msg)

    if (!(handler instanceof EventEmitter)) {
      return console.warn(
        'Handler is not an EventEmitter, so it does not support adding listeners'
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

  /** @param {any[]} msg */
  function handleOff (msg) {
    if (!isValidMessage(msg)) return

    const [, eventName] = /** @type {MsgOff} */ (msg)

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
    }
  }
}
