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
    [1, 4, null, Buffer.from('returnedValue')],
    [1, 4, null, Buffer.from('returnedValue'), true],
    [1, 4, null, null, false, true],
    [1, 5, { message: 'Error message' }],
    [1, 6, null],
    [4, 'eventName', [], null, []],
    [4, 'eventName', [['method']], null, ['param1', { other: 'param' }]],
    [4, 'eventName', [], { message: 'Error Message' }],
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
