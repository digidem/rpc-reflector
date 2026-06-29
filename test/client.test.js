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

test('Responses do not cross between clients sharing one transport', (t) => {
  // Regression for https://github.com/digidem/rpc-reflector/issues/46: two
  // clients over a single transport used to both number msgIds from 0, so a
  // late response for one client could resolve the other's pending call.
  t.plan(3)

  // Each client picks its msgId namespace from Math.random() at creation. Force
  // two distinct draws so the test is deterministic — a real-world nonce
  // collision (~1e-8) would be an actual #46 recurrence, not a test artifact.
  const realRandom = Math.random
  const nonces = [0.1, 0.6]
  let draw = 0
  Math.random = () => nonces[draw++] ?? realRandom()
  t.teardown(() => {
    Math.random = realRandom
  })

  /** @type {import('../lib/types.js').MsgRequest[]} */
  const requests = []
  // A single shared port that broadcasts every response to all listeners, as a
  // real shared MessagePort does. Both clients attach to it.
  const sharedPort = new MessagePortLike((msg) => requests.push(msg))

  const clientA = createClient(/** @type {any} */ (sharedPort), {
    timeout: 200,
  })
  const clientB = createClient(/** @type {any} */ (sharedPort), {
    timeout: 200,
  })

  const callA = /** @type {any} */ (clientA).deviceId()
  const callB = /** @type {any} */ (clientB).createProject()

  const [reqA, reqB] = requests
  t.notEqual(reqA[1], reqB[1], 'The two clients use distinct msgIds')

  // Deliver responses in crossed order: clientA's response carries clientB's
  // value first. Each is broadcast to both clients; only the matching msgId
  // resolves.
  sharedPort.dispatchEvent(
    /** @type {any} */ ({
      type: 'message',
      data: [msgType.RESPONSE, reqA[1], null, 'deviceId-value'],
    }),
  )
  sharedPort.dispatchEvent(
    /** @type {any} */ ({
      type: 'message',
      data: [msgType.RESPONSE, reqB[1], null, 'project-value'],
    }),
  )

  callA.then(
    /** @param {any} value */ (value) =>
      t.equal(value, 'deviceId-value', 'clientA resolves with its own value'),
    t.fail,
  )
  callB.then(
    /** @param {any} value */ (value) =>
      t.equal(value, 'project-value', 'clientB resolves with its own value'),
    t.fail,
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
