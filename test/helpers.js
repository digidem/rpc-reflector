const { EventEmitter } = require('events')

class MessagePortLike extends EventEmitter {
  /** @param {(data: any) => void} handler */
  constructor(handler) {
    super()
    this._handler = handler
  }
  /** @param {any} data */
  postMessage(data) {
    this._handler(data)
  }
}

class MessagePortPair {
  constructor() {
    /** @type {MessagePortLike} */
    this.port1 = new MessagePortLike((data) => this.port2.emit('message', data))
    /** @type {MessagePortLike} */
    this.port2 = new MessagePortLike((data) => this.port1.emit('message', data))
  }
}

module.exports = { MessagePortPair, MessagePortLike }
