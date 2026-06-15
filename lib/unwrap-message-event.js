// @ts-check

/**
 * Normalise an incoming transport value to the rpc-reflector message it carries.
 *
 * Browser and Electron `MessagePort`s deliver a `MessageEvent` whose payload is
 * in `.data`, whereas Node `worker_threads` `MessagePort`s, EventEmitter-style
 * ports and object-mode streams deliver the message directly. rpc-reflector's
 * own top-level wire shapes are a message array (`[msgType, ...]`) or a
 * `{ value, metadata? }` container — neither of which is a `MessageEvent`. So we
 * only unwrap `.data` when the value is neither of those.
 *
 * This is what lets a message *payload* safely contain a `data` key: payloads
 * always travel nested inside the message array (or under `value`), never as the
 * top-level transport value, so they are never inspected here.
 *
 * @param {unknown} received The value handed to the transport's message listener
 * @returns {unknown} The rpc-reflector message (array or `{ value, metadata? }`)
 */
export function unwrapMessageEvent(received) {
  if (
    received &&
    typeof received === 'object' &&
    !Array.isArray(received) &&
    !('value' in received) &&
    'data' in received
  ) {
    return received.data
  }
  return received
}
