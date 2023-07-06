// @ts-check

const prefix = 'Invariant failed'

module.exports = {
  invariant,
}

/**
 *
 * @param {any} condition
 * @param {string | (() => string)} [message]
 * @returns {asserts condition}
 */
function invariant(condition, message) {
  if (condition) return
  const provided = typeof message === 'function' ? message() : message

  // Options:
  // 1. message provided: `${prefix}: ${provided}`
  // 2. message not provided: prefix
  const value = provided ? `${prefix}: ${provided}` : prefix
  throw new Error(value)
}
