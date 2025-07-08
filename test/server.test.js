//@ts-nocheck
import test from 'tape'

import { createServer } from '../lib/index.js'
import invalidMessages from './fixtures/invalid-messages.js'
import { MessagePortPair } from './helpers.js'

test('Ignores invalid messages', (t) => {
  t.plan(1)
  const { port1, port2 } = new MessagePortPair()

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

  port2.on('message', () => {
    t.fail('Should ignore all invalid messages')
  })
  createServer({}, port1)
  for (const msg of invalidMessages.concat(validOnlyForClient)) {
    port2.postMessage(msg)
  }
  t.pass('Ignored all invalid messages')
})
