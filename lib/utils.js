// @ts-check

const prefix = 'Invariant failed'

/**
 * @param {any} condition
 * @param {string | (() => string)} [message]
 * @returns {asserts condition}
 */
export function invariant(condition, message) {
  if (condition) return
  const provided = typeof message === 'function' ? message() : message

  // Options:
  // 1. message provided: `${prefix}: ${provided}`
  // 2. message not provided: prefix
  const value = provided ? `${prefix}: ${provided}` : prefix
  throw new Error(value)
}

export class ExhaustivenessError extends Error {
  /** @param {never} value */
  constructor(value) {
    super(`Exhaustiveness check failed. ${value} should be impossible`)
    this.name = 'ExhaustivenessError'
  }
}
