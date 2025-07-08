/** @typedef {import('./types.js').MessagePortLike} MessagePortLike */
/** @typedef {import('worker_threads').MessagePort} MessagePortNode */

/**
 * Check if a value is a MessagePort-like object with `on` and `postMessage`
 * methods
 *
 * @param {unknown} value
 * @returns {value is (MessagePort | MessagePortNode | MessagePortLike)}
 */
export function isMessagePortLike(value) {
  if (typeof value !== 'object' || value === null) return false
  /* c8 ignore start - not testing in browser env yet */
  if (
    typeof window !== 'undefined' &&
    'MessagePort' in window &&
    value instanceof window.MessagePort
  ) {
    return true
    /* c8 ignore stop */
  } else if (
    'on' in value &&
    typeof value.on === 'function' &&
    'off' in value &&
    typeof value.off === 'function' &&
    'postMessage' in value &&
    typeof value.postMessage === 'function'
  ) {
    return true
  }
  return false
}
