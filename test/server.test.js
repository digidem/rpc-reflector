// @ts-nocheck
const test = require('tape-async')
const { PassThrough } = require('stream')
const duplexify = require('duplexify')

const { createServer } = require('..')
const invalidMessages = require('./fixtures/invalid-messages')

test('Ignores invalid messages', (t) => {
  t.plan(1)
  const writeable = new PassThrough({ objectMode: true })
  const readable = new PassThrough({ objectMode: true })
  const stream = duplexify(writeable, readable, { objectMode: true })

  const validOnlyForClient = [
    [1, 4, null, 'returnedValue'],
    [4, 'eventName', null, []],
  ]

  writeable.on('data', () => {
    t.fail('Should ignore all invalid messages')
  })
  createServer({}, stream)
  for (const msg of invalidMessages.concat(validOnlyForClient)) {
    readable.write(msg)
  }
  t.pass('Ignored all invalid messages')
})
