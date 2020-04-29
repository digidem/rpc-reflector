const test = require('tape-async')
const { Readable } = require('stream')
const { Readable: Readable3 } = require('readable-stream')
const isObjectMode = require('../lib/is-object-mode-readable')

test('Detects if ReadableStream is in objectMode', (t) => {
  t.true(isObjectMode(new Readable({ objectMode: true })), 'detects objectMode')
  t.false(isObjectMode(new Readable()), 'detects not objectMode')
  // readable-stream@3 is the same as Node 10 streams, above tests Node 12 streams
  t.true(
    isObjectMode(new Readable3({ objectMode: true })),
    'detects objectMode'
  )
  t.false(isObjectMode(new Readable3()), 'detects not objectMode')
  t.end()
})
