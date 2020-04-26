// @ts-nocheck
const test = require('tape-async')
const { PassThrough } = require('stream')
const duplexify = require('duplexify')

const { CreateServer } = require('..')
const invalidMessages = require('./fixtures/invalid-messages.json')

test('Ignores invalid messages', t => {
  t.plan(1)
  const writeable = new PassThrough({ objectMode: true })
  const readable = new PassThrough({ objectMode: true })
  const stream = duplexify(writeable, readable, { objectMode: true })

  writeable.on('data', () => {
    t.fail('Should ignore all invalid messages')
  })
  CreateServer({}, stream)
  for (const msg of invalidMessages) {
    readable.write(msg)
  }
  t.pass('Ignored all invalid messages')
})
