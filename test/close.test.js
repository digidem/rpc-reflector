// @ts-check
import test from 'tape'

import { createClient, ChannelClosedError } from '../index.js'
import { msgType } from '../lib/constants.js'
import { MessagePortLikePair } from './helpers.js'

test('calling a method after close() rejects synchronously with a ChannelClosedError', (t) => {
  t.plan(3)
  const { port1, port2 } = new MessagePortLikePair()
  let postCloseMessages = 0
  port2.addEventListener('message', () => {
    postCloseMessages++
  })

  const client = createClient(port1, { timeout: 200 })
  createClient.close(client)

  // @ts-expect-error
  client.anyMethod().then(
    () => t.fail('Expected rejection'),
    /** @param {Error} err */
    (err) => {
      t.ok(
        err instanceof ChannelClosedError,
        'Rejects with a ChannelClosedError instance',
      )
      t.equal(
        /** @type {any} */ (err).code,
        'RPC_CHANNEL_CLOSED',
        'Error has a stable RPC_CHANNEL_CLOSED code',
      )
      t.equal(postCloseMessages, 0, 'No IPC message is sent after close')
    },
  )
})

test('close() is idempotent', (t) => {
  const { port1, port2 } = new MessagePortLikePair()
  port2.addEventListener('message', () => {})

  const client = createClient(port1, { timeout: 200 })

  t.doesNotThrow(() => {
    createClient.close(client)
    createClient.close(client)
  }, 'Calling close() twice does not throw')

  t.end()
})

test('close() also clears collector entries (no leaked half-streamed responses)', (t) => {
  t.plan(2)
  const { port1, port2 } = new MessagePortLikePair()

  port2.addEventListener('message', (event) => {
    const msg = 'data' in event ? event.data : undefined
    if (!Array.isArray(msg)) throw new Error('Expected message to be an array')
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
        t.ok(
          err instanceof ChannelClosedError,
          'Streaming request rejects with a ChannelClosedError on close',
        )
      },
    )
  })
})
