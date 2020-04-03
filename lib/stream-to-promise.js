const concat = require('concat-stream')
const once = require('once')

/** @typedef {'string' | 'buffer' | 'array' | 'uint8array' | 'u8' | 'uint8' | 'object'} Encoding */

/**
 * Converts a readable stream into a Promise that will resolve with the
 * concatenated results of the stream
 *
 * @param {import("stream").Readable} stream
 * @param {{encoding?: Encoding}} [opts]
 * @returns {Promise<any>}
 */
module.exports = function streamToPromise (stream, opts = {}) {
  return new Promise((resolve, reject) => {
    stream.on('error', once(reject))
    stream.pipe(concat(opts, resolve))
  })
}
