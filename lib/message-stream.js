const { serializeError } = require('serialize-error')
const { Transform } = require('stream')

const isObjectMode = require('./is-object-mode-readable')
const { msgType } = require('./constants')

/** @typedef {(error?: Error | null, data?: import('./types').MsgResponse) => void} TransformCallback */

class MessageStream extends Transform {
  /**
   * @param {number} msgId
   * @param {import('stream').TransformOptions} [options]
   */
  constructor(msgId, options) {
    super({ ...options, objectMode: true })
    this._msgId = msgId
    // Bubble errors as messages
    this.once('pipe', (src) => {
      // Is the stream being piped in in objectMode?
      this._incomingObjectMode = isObjectMode(src)
      src.once(
        'error',
        /** @type {(err: Error) => void} */
        (err) => {
          this.push([msgType.RESPONSE, msgId, serializeError(err)])
          this.destroy()
        }
      )
    })
  }

  /** @type {(chunk: any, encoding: string, callback: TransformCallback) => void} */
  _transform(chunk, encoding, cb) {
    cb(null, [msgType.RESPONSE, this._msgId, null, chunk, true])
  }

  /** @type {(callback: TransformCallback) => void} */
  _flush(cb) {
    cb(null, [
      msgType.RESPONSE,
      this._msgId,
      null,
      null,
      false,
      !!this._incomingObjectMode,
    ])
  }
}

module.exports = MessageStream
