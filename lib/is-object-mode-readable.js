/**
 * @private
 * Checks if a ReadableStream is in objectMode
 *
 * @param {import('readable-stream').Readable} rs
 * @returns {boolean}
 */
export function isObjectMode(rs) {
  // readableObjectMode was added in Node 12.3, but it's not in
  // readable-stream@3 so most streaming libraries don't support it
  if ('readableObjectMode' in rs) {
    return rs.readableObjectMode
  }
  // https://github.com/nodejs/node/blob/v12.16.3/lib/_stream_readable.js#L1089
  // @ts-ignore
  return rs._readableState ? rs._readableState.objectMode : false
}
