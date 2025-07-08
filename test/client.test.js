import test from 'tape'

import { createClient } from '../lib/index.js'
import { msgType } from '../lib/constants.js'
import invalidMessages from './fixtures/invalid-messages.js'
import { MessagePortPair } from './helpers.js'

test('Client can call methods', (t) => {
  t.plan(1)
  const { port1, port2 } = new MessagePortPair()
  const expectedResult = { result: 'success' }

  port2.on('message', (msg) => {
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
  const { port1, port2 } = new MessagePortPair()
  const expectedResult = {}

  port2.on('message', () => {
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
  const { port1, port2 } = new MessagePortPair()

  const validOnlyForServer = [
    [0, 2, [['anyMethod', []]]],
    [0, 3, [['anyMethod', ['param2', { other: 'param' }]]]],
    [2, 'eventName', []],
    [3, 'eventName', [['method']]],
  ]

  port2.on('message', (outgoingMsg) => {
    // @ts-ignore
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
