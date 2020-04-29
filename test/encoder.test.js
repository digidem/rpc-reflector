const test = require('tape-async')
const createDecodeStream = require('../encode-decode')
const { Readable, Writable, PassThrough } = require('stream')
const duplexify = require('duplexify')
const through = require('through2')
const validMessages = require('./fixtures/valid-messages')

test('Encodes and decodes valid messages', (t) => {
  let pending = validMessages.length
  t.plan(pending * 3)
  const passthrough = through.obj((chunk, enc, cb) => {
    // Called twice for each message - once with length prefix then with encoded message
    t.ok(Buffer.isBuffer(chunk), 'Chunks in duplex are encoded as buffer')
    cb(null, chunk)
  })
  const decoded = createDecodeStream(passthrough)
  decoded.on('data', (d) => {
    t.deepEqual(
      d,
      validMessages[validMessages.length - pending--],
      'Message decoded as expected'
    )
  })
  for (const msg of validMessages) {
    decoded.write(msg)
  }
  decoded.end()
})

test('Accepts custom encoding', (t) => {
  /** @type {import('../encode-decode').Encoding} */
  const encoding = {
    encode: (object) => Buffer.from(JSON.stringify(object)),
    decode: (data) => JSON.parse(data.toString()),
  }
  const testMsg = [0, 3, 'anyMethod', ['param2', { other: 'param' }]]
  t.plan(2)

  const passthrough = through.obj((chunk, enc, cb) => {
    // Skip the length-prefixed message
    if (chunk.length > 4) {
      t.deepEqual(
        chunk,
        Buffer.from(JSON.stringify(testMsg)),
        'Chunk is encoded as expected'
      )
    }
    cb(null, chunk)
  })
  const decoded = createDecodeStream(passthrough, { encoding })
  decoded.on('data', (d) => {
    t.deepEqual(d, testMsg, 'Message decoded as expected')
  })
  decoded.write(testMsg)
  decoded.end()
})
