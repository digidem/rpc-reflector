// @ts-check
import { createErrorClass } from 'custom-error-creator'

export const ChannelClosedError = createErrorClass({
  code: 'RPC_CHANNEL_CLOSED',
  message: 'Channel closed: tried to call a method on a closed RPC channel',
})

export const TimeoutError = createErrorClass({
  code: 'RPC_TIMEOUT',
  message: (/** @type {{ timeout: number }} */ { timeout }) =>
    `Server timed out after ${timeout}ms. The server could be closed or the transport is down.`,
})
