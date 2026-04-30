// @ts-check
import test from 'tape'

import { createClient } from '../index.js'
import { msgType } from '../lib/constants.js'
import { MessagePortPair } from './helpers.js'

test('close() rejects in-flight requests with "Channel closed" instead of timing out', (t) => {
  t.plan(1)
  const { port1, port2 } = new MessagePortPair()
  // Server absorbs messages and never responds.
  port2.on('message', () => {})

  const client = createClient(port1, { timeout: 5000 })
  // @ts-expect-error
  const requestPromise = client.someMethod()

  createClient.close(client)

  const timeoutGuard = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('test timed out')), 500),
  )

  Promise.race([requestPromise, timeoutGuard]).then(
    () => t.fail('Expected request to reject with "Channel closed"'),
    /** @param {Error} err */
    (err) => {
      t.equal(
        err.message,
        'Channel closed',
        'Pending request rejects fast with "Channel closed"',
      )
    },
  )
})

test('calling a method after close() rejects synchronously with "Channel closed"', (t) => {
  t.plan(2)
  const { port1, port2 } = new MessagePortPair()
  let postCloseMessages = 0
  port2.on('message', () => {
    postCloseMessages++
  })

  const client = createClient(port1, { timeout: 200 })
  createClient.close(client)

  // @ts-expect-error
  client.anyMethod().then(
    () => t.fail('Expected rejection'),
    /** @param {Error} err */
    (err) => {
      t.equal(
        err.message,
        'Channel closed',
        'Method called after close rejects with "Channel closed"',
      )
      t.equal(postCloseMessages, 0, 'No IPC message is sent after close')
    },
  )
})

test('close() is idempotent', (t) => {
  const { port1, port2 } = new MessagePortPair()
  port2.on('message', () => {})

  const client = createClient(port1, { timeout: 200 })

  t.doesNotThrow(() => {
    createClient.close(client)
    createClient.close(client)
  }, 'Calling close() twice does not throw')

  t.end()
})

test('close() also clears collector entries (no leaked half-streamed responses)', (t) => {
  t.plan(2)
  const { port1, port2 } = new MessagePortPair()

  port2.on('message', (msg) => {
    if (msg[0] !== msgType.REQUEST) return
    // Begin a streaming response with `more=true` so the client's collector
    // map gets populated, but never send the final chunk.
    port2.postMessage([msgType.RESPONSE, msg[1], null, 'chunk1', true])
  })

  const client = createClient(port1, { timeout: 5000 })
  // @ts-expect-error
  const requestPromise = client.streamingMethod()

  // Wait one tick so the first streamed chunk is delivered before we close.
  setImmediate(() => {
    createClient.close(client)

    // After close, the message listener must be detached so subsequent
    // chunks from the server cannot be processed.
    t.equal(
      port1.listenerCount('message'),
      0,
      'Message listener detached after close',
    )

    const timeoutGuard = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('test timed out')), 500),
    )

    Promise.race([requestPromise, timeoutGuard]).then(
      () => t.fail('Expected rejection'),
      /** @param {Error} err */
      (err) => {
        t.equal(
          err.message,
          'Channel closed',
          'Streaming request rejects with "Channel closed" on close',
        )
      },
    )
  })
})
