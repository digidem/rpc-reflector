import { Readable } from 'readable-stream'

/** @import {MessagePortLike as MessagePortLikeInterface, MessageEvent} from '../lib/types.js' */

/** @implements {MessagePortLikeInterface} */
export class MessagePortLike {
  #handler
  /** @type {Map<string, Set<(event: MessageEvent<any>) => void>>} */
  #listeners = new Map()

  /** @param {(data: any) => void} handler */
  constructor(handler) {
    this.#handler = handler
  }

  /** @type {MessagePortLikeInterface['addEventListener']} */
  addEventListener(type, listener) {
    let listeners = this.#listeners.get(type)
    if (!listeners) this.#listeners.set(type, (listeners = new Set()))
    listeners.add(listener)
  }

  /** @type {MessagePortLikeInterface['removeEventListener']} */
  removeEventListener(type, listener) {
    if (listener) this.#listeners.get(type)?.delete(listener)
  }

  /** @param {string} type */
  listenerCount(type) {
    return this.#listeners.get(type)?.size ?? 0
  }

  /** @param {any} data */
  postMessage(data) {
    this.#handler(data)
  }

  /** @param {MessageEvent & { type: string }} event */
  dispatchEvent(event) {
    const listeners = this.#listeners.get(event.type)
    if (!listeners)
      throw new Error(`No listeners for event type "${event.type}"`)
    for (const listener of listeners) {
      listener.call(this, event)
    }
  }
}

export class MessagePortLikePair {
  constructor() {
    this.port1 = new MessagePortLike((data) =>
      this.port2.dispatchEvent(new MessageEvent('message', { data })),
    )
    this.port2 = new MessagePortLike((data) =>
      this.port1.dispatchEvent(new MessageEvent('message', { data })),
    )
  }
}

export class ReadableError extends Readable {
  /** @param {Error} err */
  constructor(err) {
    super({
      read: () => {
        this.emit('error', err)
      },
    })
  }
}
