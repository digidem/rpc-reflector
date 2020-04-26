const { serializeError } = require('serialize-error')
const { Transform } = require('stream')

const { msgType } = require('./constants')

class MessageStream extends Transform {
  /**
   * @param {number} msgId
   * @param {import('stream').TransformOptions} [options]
   */
  constructor (msgId, options) {
    super({ ...options, objectMode: true })
    this._msgId = msgId
    this.once('pipe', src => {
      src.once(
        'error',
        /** @type {(err: Error) => void} */
        err => {
          this.push([msgType.RESPONSE, msgId, serializeError(err)])
        }
      )
    })
  }

  // @ts-ignore
  _transform (chunk, encoding, cb) {
    cb(null, [msgType.RESPONSE, this._msgId, null, chunk, true])
  }

  // @ts-ignore
  _flush (cb) {
    cb(null, [msgType.RESPONSE, this._msgId, null])
  }
}

module.exports = MessageStream
