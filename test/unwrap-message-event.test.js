// @ts-check
import test from 'tape'
import { unwrapMessageEvent } from '../lib/unwrap-message-event.js'

test('unwrapMessageEvent: passes through transports that deliver the raw message', (t) => {
  const array = [0, 1, ['method'], []]
  t.equal(
    unwrapMessageEvent(array),
    array,
    'message arrays are returned unchanged',
  )

  const container = { value: [0, 1, ['method'], []], metadata: { foo: 'bar' } }
  t.equal(
    unwrapMessageEvent(container),
    container,
    '{ value, metadata } containers are returned unchanged',
  )
  t.end()
})

test('unwrapMessageEvent: unwraps a MessageEvent-style wrapper', (t) => {
  const message = [0, 1, ['method'], []]
  t.equal(
    unwrapMessageEvent({ data: message }),
    message,
    'the payload in `.data` is returned',
  )

  const container = { value: [0, 1, ['method'], []] }
  t.equal(
    unwrapMessageEvent({ data: container, ports: [] }),
    container,
    'an Electron-style { data, ports } wrapper is unwrapped',
  )
  t.end()
})

test('unwrapMessageEvent: a recognised message that also has a `data` key is NOT unwrapped', (t) => {
  // A `{ value, ... }` container is one of our own top-level shapes, so it must
  // be treated as the message even if it happens to carry a `data` property.
  // This is the regression the discriminator guards against.
  const container = { value: [0, 1, ['method'], []], data: 'not-an-event' }
  t.equal(
    unwrapMessageEvent(container),
    container,
    'container with a `data` key is returned unchanged, not unwrapped to its `data`',
  )
  t.end()
})

test('unwrapMessageEvent: non-objects are returned unchanged', (t) => {
  t.equal(unwrapMessageEvent(null), null, 'null')
  t.equal(unwrapMessageEvent(undefined), undefined, 'undefined')
  t.equal(unwrapMessageEvent('string'), 'string', 'string')
  t.equal(unwrapMessageEvent(42), 42, 'number')
  t.end()
})
