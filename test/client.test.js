const test = require('tape-async')
const { PassThrough } = require('readable-stream')
const duplexify = require('duplexify')

const { createClient } = require('..')
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
    .catch(
      /** @param {Error} err */
      (err) => {
        t.ok(
          /timed out/.test(err.message),
          'Request times out (messages ignored)'
        )
      }
    )
})

test('Ignores invalid messages', (t) => {
  t.plan(1)
  const writeable = new PassThrough({ objectMode: true })
  const readable = new PassThrough({ objectMode: true })
  const stream = duplexify(writeable, readable, { objectMode: true })

  const validOnlyForServer = [
    [0, 2, [['anyMethod', []]]],
    [0, 3, [['anyMethod', ['param2', { other: 'param' }]]]],
    [2, 'eventName', []],
    [3, 'eventName', [['method']]],
  ]

  writeable.on('data', (outgoingMsg) => {
    // @ts-ignore
    for (const msg of invalidMessages.concat(validOnlyForServer)) {
      // @ts-ignore
      if (typeof msg[1] === 'number') {
        // @ts-ignore
        msg[1] = outgoingMsg[1]
      }
      readable.write(msg)
    }
  })

  const client = createClient(stream, { timeout: 200 })
  client
    .myMethod()
    .then(t.fail)
    .catch(
      /** @param {Error} err */
      (err) => {
        t.ok(
          /timed out/.test(err.message),
          'Request times out (messages ignored)'
        )
      }
    )
})
