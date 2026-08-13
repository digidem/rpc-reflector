// @ts-check
import test from 'tape'

import { createClient } from '../index.js'
import { msgType } from '../lib/constants.js'
import { MessagePortLikePair, createTestLogger } from './helpers.js'

test('rejectPending() rejects in-flight calls with the given error and the client remains usable', async (t) => {
  const { port1, port2 } = new MessagePortLikePair()
  let respondToRequests = false
  port2.addEventListener('message', (event) => {
    const msg = 'data' in event ? event.data : undefined
    if (!Array.isArray(msg)) throw new Error('Expected message to be an array')
    if (msg[0] !== msgType.REQUEST) return
    if (respondToRequests) {
      port2.postMessage([msgType.RESPONSE, msg[1], null, 'result'])
    }
  })

  const client = createClient(port1, { timeout: 200 })
  const transportError = new Error('transport dropped')

  // @ts-expect-error
  const inFlight1 = client.methodOne()
  // @ts-expect-error
  const inFlight2 = client.methodTwo()

  const rejectedCount = createClient.rejectPending(client, transportError)
  t.equal(rejectedCount, 2, 'Returns the number of calls rejected')

  for (const inFlight of [inFlight1, inFlight2]) {
    try {
      await inFlight
      t.fail('Expected rejection')
    } catch (err) {
      t.equal(err, transportError, 'Rejects with the caller-supplied error')
    }
  }

  t.equal(
    createClient.rejectPending(client, transportError),
    0,
    'Returns 0 when nothing is pending',
  )

  // Wait past the call timeout to verify the p-timeout timers of the rejected
  // calls were settled and cannot fire (tape would report extra assertions or
  // an unhandled rejection if they did).
  await new Promise((resolve) => setTimeout(resolve, 300))

  respondToRequests = true
  // @ts-expect-error
  const result = await client.methodThree()
  t.equal(result, 'result', 'Client still works after rejectPending()')
})

test('a late response for a call rejected by rejectPending() is ignored gracefully', async (t) => {
  const { port1, port2 } = new MessagePortLikePair()
  /** @type {number | undefined} */
  let requestMsgId
  port2.addEventListener('message', (event) => {
    const msg = 'data' in event ? event.data : undefined
    if (!Array.isArray(msg)) throw new Error('Expected message to be an array')
    if (msg[0] === msgType.REQUEST) requestMsgId = msg[1]
  })

  /** @type {unknown[]} */
  const warnings = []
  const logger = createTestLogger({
    warn: (...args) => warnings.push(args),
  })
  const client = createClient(port1, { timeout: 200, logger })

  // @ts-expect-error
  const inFlight = client.myMethod()
  createClient.rejectPending(client, new Error('transport dropped'))
  await inFlight.catch(() => {})

  t.doesNotThrow(() => {
    port2.postMessage([msgType.RESPONSE, requestMsgId, null, 'late result'])
  }, 'Late response for a rejected msgId does not throw')
  t.equal(warnings.length, 1, 'Late response is logged as ignored')
})

test('resubscribe() re-sends ON for root and nested events with listeners, but not unsubscribed ones', (t) => {
  const { port1, port2 } = new MessagePortLikePair()
  /** @type {Array<[number, string, string[]]>} */
  const onMessages = []
  port2.addEventListener('message', (event) => {
    const msg = 'data' in event ? event.data : undefined
    if (!Array.isArray(msg)) throw new Error('Expected message to be an array')
    if (msg[0] === msgType.ON) onMessages.push(/** @type {any} */ (msg))
  })

  const client = createClient(port1, { timeout: 200 })
  const noop = () => {}
  // @ts-expect-error
  client.on('rootEvent', noop)
  // @ts-expect-error
  client.$sync.on('nestedEvent', noop)
  // @ts-expect-error
  client.on('unsubscribedEvent', noop)
  // @ts-expect-error
  client.off('unsubscribedEvent', noop)

  onMessages.length = 0
  const sentCount = createClient.resubscribe(client)

  t.equal(sentCount, 2, 'Returns the number of ON messages sent')
  t.deepEqual(
    onMessages.sort((a, b) => a[1].localeCompare(b[1])),
    [
      [msgType.ON, 'nestedEvent', ['$sync']],
      [msgType.ON, 'rootEvent', []],
    ],
    'Re-sends ON with the correct event name and propArray for subscribed events only',
  )
  t.end()
})

test('emitLocal() emits to locally-registered listeners without wire traffic', (t) => {
  const { port1, port2 } = new MessagePortLikePair()
  /** @type {unknown[]} */
  const wireMessages = []
  port2.addEventListener('message', (event) => {
    wireMessages.push('data' in event ? event.data : undefined)
  })

  const client = createClient(port1, { timeout: 200 })
  /** @type {unknown[][]} */
  const received = []
  // @ts-expect-error
  client.once('close', (...args) => received.push(args))

  wireMessages.length = 0
  const hadListeners = createClient.emitLocal(client, 'close', 'arg1', 2)

  t.ok(hadListeners, 'Returns true when the event had listeners')
  t.deepEqual(
    received,
    [['arg1', 2]],
    'Listener registered via .once() receives the event and its args (encoded-name round trip)',
  )
  t.equal(wireMessages.length, 0, 'No messages are sent over the wire')

  t.equal(
    createClient.emitLocal(client, 'close'),
    false,
    'Returns false once the .once() listener has been removed',
  )
  t.end()
})

test('emitLocal() does not reach nested sub-client listeners and is a no-op after close()', (t) => {
  const { port1, port2 } = new MessagePortLikePair()
  port2.addEventListener('message', () => {})
  const client = createClient(port1, { timeout: 200 })

  let nestedCalls = 0
  // @ts-expect-error
  client.$sub.on('close', () => nestedCalls++)
  t.equal(
    createClient.emitLocal(client, 'close'),
    false,
    'Returns false when only a nested sub-client has a listener',
  )
  t.equal(nestedCalls, 0, 'Nested sub-client listener is not called')

  let rootCalls = 0
  // @ts-expect-error
  client.on('close', () => rootCalls++)
  createClient.close(client)
  t.equal(
    createClient.emitLocal(client, 'close'),
    false,
    'Returns false on a closed client',
  )
  t.equal(rootCalls, 0, 'No listener is called after close')
  t.end()
})

test('rejectPending() and resubscribe() are no-ops after close()', (t) => {
  const { port1, port2 } = new MessagePortLikePair()
  let messagesAfterClose = 0
  port2.addEventListener('message', (event) => {
    const msg = 'data' in event ? event.data : undefined
    if (!Array.isArray(msg)) throw new Error('Expected message to be an array')
    if (msg[0] === msgType.REQUEST) return // never respond
    messagesAfterClose++
  })

  const client = createClient(port1, { timeout: 200 })
  // @ts-expect-error
  client.on('someEvent', () => {})
  // @ts-expect-error
  client.myMethod().catch(() => {})

  messagesAfterClose = 0
  createClient.close(client)

  t.equal(
    createClient.rejectPending(client, new Error('nope')),
    0,
    'rejectPending() returns 0 on a closed client',
  )
  t.equal(
    createClient.resubscribe(client),
    0,
    'resubscribe() returns 0 on a closed client',
  )
  t.equal(messagesAfterClose, 0, 'No IPC messages are sent after close')
  t.end()
})
