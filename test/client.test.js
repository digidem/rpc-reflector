import test from 'tape'

import { createClient } from '../index.js'
import { msgType } from '../lib/constants.js'
import invalidMessages from './fixtures/invalid-messages.js'
import { MessagePortLike, createTestLogger } from './helpers.js'

test('Client can call methods', (t) => {
  t.plan(1)
  const { port1, port2 } = new MessageChannel()
  t.teardown(() => {
    port1.close()
    port2.close()
  })
  const expectedResult = { result: 'success' }

  port2.addEventListener('message', ({ data: msg }) => {
    if (!Array.isArray(msg)) throw new Error('Expected message to be an array')
    if (msg[0] === msgType.REQUEST && msg[2][0] === 'myMethod') {
      port2.postMessage([msgType.RESPONSE, msg[1], null, expectedResult])
    }
  })
  const client = createClient(port1, { timeout: 200 })
  client
    // @ts-expect-error
    .myMethod()
    // @ts-expect-error
    .then((result) => {
      t.deepEqual(result, expectedResult, 'Method returns expected result')
    })
    .catch(t.fail)
})

test('Method ignores response on different messageId', (t) => {
  t.plan(1)
  const { port1, port2 } = new MessageChannel()
  t.teardown(() => {
    port1.close()
    port2.close()
  })
  const expectedResult = {}

  port2.addEventListener('message', ({ data: msg }) => {
    if (!Array.isArray(msg)) throw new Error('Expected message to be an array')
    port2.postMessage([msgType.RESPONSE, 9999, null, expectedResult])
  })
  const client = createClient(port1, { timeout: 200 })
  client
    // @ts-expect-error
    .myMethod()
    .then(t.fail)
    .catch(
      /** @param {Error} err */
      (err) => {
        t.ok(
          /timed out/.test(err.message),
          'Request times out (messages ignored)',
        )
      },
    )
})

test('Ignores invalid messages', (t) => {
  t.plan(1)
  const { port1, port2 } = new MessageChannel()
  t.teardown(() => {
    port1.close()
    port2.close()
  })

  const validOnlyForServer = [
    [0, 2, [['anyMethod', []]]],
    [0, 3, [['anyMethod', ['param2', { other: 'param' }]]]],
    [2, 'eventName', []],
    [3, 'eventName', [['method']]],
  ]

  port2.addEventListener('message', ({ data: outgoingMsg }) => {
    if (!Array.isArray(outgoingMsg))
      throw new Error('Expected message to be an array')
    for (const msg of invalidMessages.concat(validOnlyForServer)) {
      // @ts-ignore
      if (typeof msg[1] === 'number') {
        // @ts-ignore
        msg[1] = outgoingMsg[1]
      }
      port2.postMessage(msg)
    }
  })

  const client = createClient(port1, { timeout: 200 })
  client
    // @ts-expect-error
    .myMethod()
    .then(t.fail)
    .catch(
      /** @param {Error} err */
      (err) => {
        t.ok(
          /timed out/.test(err.message),
          'Request times out (messages ignored)',
        )
      },
    )
})

test('Ignores a message that is not a MessageEvent', (t) => {
  t.plan(1)
  const port = new MessagePortLike(() => {})
  const logger = createTestLogger({
    warn(_obj, msg) {
      t.equal(
        msg,
        'Received non-MessageEvent (ignored)',
        'Warns and ignores the broken message',
      )
    },
  })
  createClient(port, { timeout: 200, logger })
  // A correct port delivers `{ data: msg }`; this one emits a shape without
  // `data`, which isn't a MessageEvent and must be ignored.
  port.dispatchEvent(/** @type {any} */ ({ type: 'message' }))
})
