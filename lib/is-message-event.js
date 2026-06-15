/**
 * Check if a value is a loosely typed MessageEvent object
 *
 * @param {unknown} value
 * @returns {value is import('./types.js').MessageEvent<any>}
 */
export function isMessageEvent(value) {
  return value !== null && typeof value === 'object' && 'data' in value
}
