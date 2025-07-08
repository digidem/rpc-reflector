import { serializeError } from 'serialize-error'
import { Transform } from 'readable-stream'

import { isObjectMode } from './is-object-mode-readable.js'
import { msgType } from './constants.js'

/** @typedef {(error?: Error | null, data?: import('./types.js').MsgResponse) => void} TransformCallback */

export class MessageStream extends Transform {
  /**
   * @param {number} msgId
   * @param {import('readable-stream').TransformOptions} [options]
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
        },
      )
    })
  }

  /**
   * @override
   * @type {(chunk: any, encoding: string, callback: TransformCallback) => void}
   */
  _transform(chunk, encoding, cb) {
    cb(null, [msgType.RESPONSE, this._msgId, null, chunk, true])
  }

  /**
   * @override
   * @type {(callback: TransformCallback) => void}
   */
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
