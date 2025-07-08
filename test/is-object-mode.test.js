import test from 'tape'
import { Readable } from 'readable-stream'
import { Readable as Readable3 } from 'readable-stream'
import { isObjectMode } from '../lib/is-object-mode-readable.js'

test('Detects if ReadableStream is in objectMode', (t) => {
  t.true(isObjectMode(new Readable({ objectMode: true })), 'detects objectMode')
  t.false(isObjectMode(new Readable()), 'detects not objectMode')
  // readable-stream@3 is the same as Node 10 streams, above tests Node 12 streams
  t.true(
    // @ts-ignore
    isObjectMode(new Readable3({ objectMode: true })),
    'detects objectMode',
  )
  // @ts-ignore
  t.false(isObjectMode(new Readable3()), 'detects not objectMode')
  t.end()
})
