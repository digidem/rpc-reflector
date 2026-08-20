import { ExhaustivenessError, invariant } from './lib/utils.js'
import { serializeError } from 'serialize-error'
import nullLogger from 'abstract-logging'
import { isReadableStream } from 'is-stream'
import { msgType } from './lib/constants.js'
import { validateMetadata, validateRequestMsg } from './lib/validate-message.js'
import { parse, stringify } from './lib/prop-array-utils.js'
import { MessageStream } from './lib/message-stream.js'
import { isMessagePortLike } from './lib/is-message-port-like.js'
import { EventEmitter } from 'events'
import ensureError from 'ensure-error'
import { isMessageEvent } from './lib/is-message-event.js'

/** @import {MsgRequestObj, Result, Metadata, MsgId} from './lib/types.js'*/
/** @typedef {import('./lib/types.js').MsgRequest} MsgRequest */
/** @typedef {import('./lib/types.js').MsgResponse} MsgResponse */
/** @typedef {import('./lib/types.js').MsgOn} MsgOn */
/** @typedef {import('./lib/types.js').MsgOff} MsgOff */
/** @typedef {import('./lib/types.js').MsgEmit} MsgEmit */
/** @typedef {import('./lib/types.js').Message} Message */
/** @typedef {import('./lib/types.js').NonEmptyArray<string>} NonEmptyStringArray */
/** @typedef {import('./lib/types.js').MessagePortLike} MessagePortLike */
/** @typedef {import('./lib/types.js').MessageEvent} MessageEvent */
/** @typedef {(request: MsgRequestObj, next: (request: Omit<MsgRequestObj, 'metadata'>) => Result) => void} OnRequestHook */
/** @typedef {import('./lib/types.js').Logger} Logger */
/** @typedef {{[method: string]: any}} Handler */
/** @typedef {() => Handler | Promise<Handler>} HandlerFactory */
/**
 * @typedef {object} ServerOptions
 * @property {false | Logger} [logger = false] options.logger Set to `false` to disable logging, or pass a logger (e.g. a pino instance or the global `console`) to enable it
 * @property {OnRequestHook} [onRequestHook] Optional hook to observe and modify a request and its metadata, and to await the response.
 */
/**
 * @typedef {object} Server
 * @property {() => void} close Stop the server listening to and sending any more messages. For a server created with a handler factory this also detaches from the current handler and clears the subscription registry.
 * @property {() => void} detachHandler Remove every listener the server attached to the current handler's emitters and release the handler reference, keeping the subscription registry so a later bind re-attaches it. Idempotent; no-op for a server created with a static handler.
 * @property {() => Promise<void>} ensureHandler Resolves once a handler is bound and the subscription registry is attached to it, invoking the handler factory if needed; rejects if the factory rejects. Resolves immediately for a server created with a static handler.
 */

/**
 * @public
 * Create an RPC server that will receive messages via `receiver`, call the
 * matching method on `handler`, and send the reply via `send`.
 *
 * @param {Handler | HandlerFactory} handler Any method called on the client
 * object will be called on this object. Methods can return a value, a Promise,
 * or a ReadableStream. Your transport stream must be able to encode/decode any
 * values that your handler returns. Pass a function to bind the handler
 * lazily: it is invoked (once, shared across concurrent triggers) when the
 * first message needing a handler arrives, or when `ensureHandler()` is
 * called, and may return the handler or a promise of it.
 * @param {MessagePortLike} messagePort A MessagePort-like object that must implement an `.addEventListener('message', (event: MessageEvent) => void)` event handler and a `.postMessage()` method.
 * @param {ServerOptions} [options] Options object
 * @returns {Server}
 */
export function createServer(
  handler,
  messagePort,
  { logger = false, onRequestHook } = {},
) {
  invariant(
    typeof handler === 'object' || typeof handler === 'function',
    'Missing handler object or factory.',
  )
  const log = logger || nullLogger
  invariant(
    isMessagePortLike(messagePort),
    'Must pass a MessagePort-like object',
  )

  const createHandler = typeof handler === 'function' ? handler : null
  /** @type {Handler | null} */
  let boundHandler = typeof handler === 'function' ? null : handler
  /** @type {Promise<void> | null} */
  let bindPromise = null
  // Bumped by detachHandler() and close(); a bind that completes under a stale
  // epoch discards its result so it cannot resurrect a detached handler.
  let bindEpoch = 0
  let closed = false

  /** @type {Map<string, (...args: any[]) => void>} */
  let subscriptions = new Map()

  messagePort.addEventListener('message', handleMessageEvent)
  log.info('RPC server created')

  /** @param {MsgResponse | MsgEmit} msg */
  function send(msg) {
    // TODO: Do we need back pressure here? Would just result in buffering here
    // vs. buffering in the stream, so probably no
    messagePort.postMessage(msg)
  }

  /**
   * Handles an incoming message.
   * @param {unknown} event Can be any type, but we only process messages types that
   * we understand, other messages are ignored
   */
  function handleMessageEvent(event) {
    if (!isMessageEvent(event)) {
      // This is a runtime check for a broken MessagePort-like implementation
      // which would break the types anyway
      log.warn({ event }, 'Received non-MessageEvent (ignored)')
      return
    }
    /** @type {unknown} */
    let msg
    /** @type {Metadata | undefined} */
    let metadata
    const messageContainer = event.data

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
        /* c8 ignore next */
        throw new ExhaustivenessError(msg[0])
    }
  }

  /**
   * @param {MsgRequestObj} request
   * @returns {Result}
   */
  function handleRequest(request) {
    const { msgId, method, args } = request
    if (!boundHandler) {
      const resultPromise = awaitBind().then(
        () => {
          if (closed) return
          // Re-checks the bound state, so if the bind completed under a stale
          // epoch (detached mid-bind) this triggers a fresh bind.
          return handleRequest(request)
        },
        (bindError) => {
          if (!closed) {
            send([
              msgType.RESPONSE,
              msgId,
              serializeError(ensureError(bindError)),
            ])
          }
          throw bindError
        },
      )
      resultPromise.catch(noop)
      return resultPromise
    }
    let syncResult
    try {
      syncResult = applyNestedMethod(boundHandler, method, args)
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
    rs.on('data', (chunk) => send(chunk))
    rs.on('error', (err) =>
      send([msgType.RESPONSE, msgId, serializeError(err)]),
    )
  }

  /** @param {MsgOn} msg */
  function handleOn(msg) {
    const [, eventName, propArray] = msg
    if (!boundHandler) {
      awaitBind().then(
        () => {
          if (closed) return
          handleOn(msg)
        },
        (err) => {
          log.warn(
            { err, eventName, propArray },
            'Error subscribing to event (ignored)',
          )
        },
      )
      return
    }
    let emitter
    try {
      emitter = getNestedEventEmitter(boundHandler, propArray)
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
    log.debug({ eventName, propArray }, 'Subscribed to handler event')
  }

  /** @param {MsgOff} msg */
  function handleOff([, eventName, propArray]) {
    if (!boundHandler) {
      // Unsubscribing only expresses lack of interest, so it must not invoke
      // the handler factory: remove from the registry only.
      subscriptions.delete(stringify(propArray, eventName))
      return
    }
    let emitter
    try {
      emitter = getNestedEventEmitter(boundHandler, propArray)
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
    log.debug({ eventName, propArray }, 'Unsubscribed from handler event')
  }

  /**
   * Single-flight bind: invoke the handler factory (sharing one invocation
   * across concurrent triggers) and bind its result. A rejection is not
   * cached — the next trigger retries the factory.
   *
   * @returns {Promise<void>}
   */
  function awaitBind() {
    if (bindPromise) return bindPromise
    const epoch = bindEpoch
    bindPromise = Promise.resolve()
      .then(/** @type {HandlerFactory} */ (createHandler))
      .then(
        (nextHandler) => {
          bindPromise = null
          if (epoch !== bindEpoch) return
          invariant(
            typeof nextHandler === 'object' && nextHandler !== null,
            'Handler factory must return an object.',
          )
          bindHandler(nextHandler)
        },
        (err) => {
          bindPromise = null
          throw err
        },
      )
    return bindPromise
  }

  /** @param {Handler} nextHandler */
  function bindHandler(nextHandler) {
    if (nextHandler === boundHandler) return
    if (boundHandler) detachAllListeners(boundHandler)
    boundHandler = nextHandler
    // Attach the subscription registry before any awaited message is
    // dispatched, so an event caused by the first call on a fresh handler
    // cannot be missed.
    for (const [encodedEventName, listener] of subscriptions.entries()) {
      const [propArray, eventName] = parse(encodedEventName)
      try {
        getNestedEventEmitter(nextHandler, propArray).on(eventName, listener)
      } catch (err) {
        log.warn(
          { err, eventName, propArray },
          'Error subscribing to event (ignored)',
        )
      }
    }
    log.debug(
      { subscriptionCount: subscriptions.size },
      'RPC server bound to handler',
    )
  }

  /** @param {Handler} fromHandler */
  function detachAllListeners(fromHandler) {
    for (const [encodedEventName, listener] of subscriptions.entries()) {
      const [propArray, eventName] = parse(encodedEventName)
      try {
        const emitter = getNestedEventEmitter(fromHandler, propArray)
        emitter.removeListener(eventName, listener)
      } catch {
        // No-op if error removing event listener
      }
    }
  }

  function detachHandler() {
    if (!createHandler) return
    bindEpoch++
    if (!boundHandler) return
    detachAllListeners(boundHandler)
    boundHandler = null
    log.debug('RPC server detached from handler')
  }

  async function ensureHandler() {
    if (!createHandler || closed) return
    // Loop because a bind can complete under a stale epoch (detached
    // mid-bind), leaving the server unbound.
    while (!boundHandler && !closed) {
      await awaitBind()
    }
  }

  return {
    close: () => {
      closed = true
      bindEpoch++
      messagePort.removeEventListener('message', handleMessageEvent)
      const subscriptionCount = subscriptions.size
      if (boundHandler) detachAllListeners(boundHandler)
      if (createHandler) boundHandler = null
      subscriptions = new Map()
      log.info({ subscriptionCount }, 'RPC server closed')
    },
    detachHandler,
    ensureHandler,
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
