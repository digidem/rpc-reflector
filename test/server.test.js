//@ts-nocheck
import test from 'tape'

import { createServer } from '../index.js'
import invalidMessages from './fixtures/invalid-messages.js'
import { MessagePortLike, createTestLogger } from './helpers.js'

test('Ignores invalid messages', (t) => {
  t.plan(1)
  const { port1, port2 } = new MessageChannel()
  t.teardown(() => {
    port1.close()
    port2.close()
  })

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

  port2.addEventListener('message', () => {
    t.fail('Should ignore all invalid messages')
  })
  createServer({}, port1)
  for (const msg of invalidMessages.concat(validOnlyForClient)) {
    port2.postMessage(msg)
  }
  // MessageChannel delivers asynchronously, so wait a tick for the server to
  // process (and ignore) every message before asserting it sent nothing back.
  setTimeout(() => t.pass('Ignored all invalid messages'), 100)
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
  createServer({}, port, { logger })
  // A correct port delivers `{ data: msg }`; this one emits a shape without
  // `data`, which isn't a MessageEvent and must be ignored.
  port.dispatchEvent({ type: 'message' })
})
