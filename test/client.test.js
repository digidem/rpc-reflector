// @ts-nocheck
const test = require('tape-async')
const { EventEmitter } = require('events')
const pIsPromise = require('p-is-promise')
const { PassThrough } = require('stream')
const duplexify = require('duplexify')

const { createClient } = require('..')
const isValidMessage = require('../lib/validate-message')
const { msgType } = require('../lib/constants')
const invalidMessages = require('./fixtures/invalid-messages')

test('Method ignores response on different messageId', (t) => {
  t.plan(1)
  const writeable = new PassThrough({ objectMode: true })
  const readable = new PassThrough({ objectMode: true })
  const stream = duplexify(writeable, readable, { objectMode: true })
  const expectedResult = {}

  writeable.on('data', (msg) => {
    readable.write([msgType.RESPONSE, Math.random(), null, expectedResult])
  })
  const client = createClient(stream, { timeout: 200 })
  client
    .myMethod()
    .then(t.fail)
    .catch((err) => {
      t.ok(
        /timed out/.test(err.message),
        'Request times out (messages ignored)'
      )
    })
})

test('Ignores invalid messages', (t) => {
  t.plan(1)
  const writeable = new PassThrough({ objectMode: true })
  const readable = new PassThrough({ objectMode: true })
  const stream = duplexify(writeable, readable, { objectMode: true })

  const validOnlyForServer = [
    [0, 2, 'anyMethod', []],
    [2, 'eventName'],
    [3, 'eventName'],
  ]

  writeable.on('data', (outgoingMsg) => {
    for (const msg of invalidMessages.concat(validOnlyForServer)) {
      if (typeof msg[1] === 'number') {
        msg[1] = outgoingMsg[1]
      }
      readable.write(msg)
    }
  })

  const client = createClient(stream, { timeout: 200 })
  client
    .myMethod()
    .then(t.fail)
    .catch((err) => {
      t.ok(
        /timed out/.test(err.message),
        'Request times out (messages ignored)'
      )
    })
})
