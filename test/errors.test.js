// @ts-check
import test from 'tape'

import { ChannelClosedError, TimeoutError } from '../index.js'

test('ChannelClosedError has a stable code, name and message', (t) => {
  const err = new ChannelClosedError()
  t.ok(err instanceof Error, 'Is an Error')
  t.equal(err.code, 'RPC_CHANNEL_CLOSED', 'Instance code')
  t.equal(err.name, 'RpcChannelClosed', 'Instance name')
  t.equal(ChannelClosedError.code, 'RPC_CHANNEL_CLOSED', 'Static code')
  t.end()
})

test('TimeoutError interpolates the timeout into its message', (t) => {
  const err = new TimeoutError({ timeout: 5000 })
  t.ok(err instanceof Error, 'Is an Error')
  t.equal(err.code, 'RPC_TIMEOUT', 'Instance code')
  t.equal(err.name, 'RpcTimeout', 'Instance name')
  t.ok(
    err.message.includes('5000ms'),
    'Message includes the timeout in milliseconds',
  )
  t.equal(TimeoutError.code, 'RPC_TIMEOUT', 'Static code')
  t.end()
})
