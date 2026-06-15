/** @typedef {import('./types.js').MessagePortLike} MessagePortLike */

/**
 * Check if a value is a MessagePort-like object with `addEventListener`,
 * `removeEventListener`, and `postMessage` methods
 *
 * @param {unknown} value
 * @returns {value is MessagePortLike}
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
    'addEventListener' in value &&
    typeof value.addEventListener === 'function' &&
    'removeEventListener' in value &&
    typeof value.removeEventListener === 'function' &&
    'postMessage' in value &&
    typeof value.postMessage === 'function'
  ) {
    return true
  }
  return false
}
