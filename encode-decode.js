const duplexify = require('duplexify')
const lpstream = require('length-prefixed-stream')
const through = require('through2')
const pump = require('pump')
const msgpack = require('@msgpack/msgpack')

/** @typedef {{encode: (object: any) => Buffer, decode: (data: Buffer) => any}} Encoding */

const extensionCodec = new msgpack.ExtensionCodec()

// msgpack defaults to decoding buffers as Uint8Array. Add extension to decode
// them to buffers
const BUF_EXT_TYPE = 0
extensionCodec.register({
  type: BUF_EXT_TYPE,
  encode: (object) => {
    if (Buffer.isBuffer(object)) {
      return msgpack.encode(object)
    } else {
      return null
    }
  },
  decode: (data) => {
    const uint8Array = /** @type {Uint8Array} */ (msgpack.decode(data))
    return Buffer.from(uint8Array)
  },
})

/** @type {Encoding} */
const defaultEncoding = {
  encode: (object) => Buffer.from(msgpack.encode(object, { extensionCodec })),
  decode: (data) => msgpack.decode(data, { extensionCodec }),
}

/**
 * @param {import('stream').Duplex} duplex Duplex stream, e.g. a socket/http connection
 * @param {object} [options]
 * @param {Encoding} [options.encoding=defaultEncoding] An encoding object that contains
 * encode(value) and decode(buffer) functions for encoding values to and from
 * buffers. Defaults to msgpack encoding with support for encoding/decoding
 * Buffers
 * @returns {import('stream').Duplex} Duplex stream in objectMode which can
 * write/read from and rpc client / server
 */
module.exports = function createEncodeDecodeStream(duplex, options = {}) {
  const { encode, decode } = options.encoding || defaultEncoding

  const encodeStream = through.obj((chunk, enc, cb) => cb(null, encode(chunk)))
  const decodeStream = through.obj((chunk, enc, cb) => cb(null, decode(chunk)))

  const unEncodedStream = duplexify(encodeStream, decodeStream, {
    objectMode: true,
  })

  pump(
    encodeStream,
    lpstream.encode(),
    duplex,
    lpstream.decode(),
    decodeStream,
    (err) => {
      unEncodedStream.destroy(err)
    }
  )

  return unEncodedStream
}
