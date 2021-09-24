module.exports = isMessagePortLike

/**
 * Check if a value is a MessagePort-like object with `on` and `postMessage`
 * methods
 *
 * @param {any} value
 * @returns {value is (MessagePort | MessagePortNode | MessagePortLike)}
 */
function isMessagePortLike(value) {
  if (typeof value !== 'object' || value === null) return false
  if (typeof window !== 'undefined' && value instanceof window.MessagePort) {
    return true
  } else if (
    typeof value.on === 'function' &&
    typeof value.off === 'function' &&
    typeof value.postMessage === 'function'
  ) {
    return true
  }
  return false
}
