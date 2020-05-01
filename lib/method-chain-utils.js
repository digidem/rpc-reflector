// A "method chain" is a way of statically expressing a chain of method calls.
// E.g. Math.pow(2, 4) is expressed as [['pow', [2, 4]]]. It also supports
// deeply dested and chained calls e.g. myApi.things.get(4).filter('foo') would
// be expressed as: [['things'], ['get', [4]], ['filter', ['foo']]] These parse
// and stringify functions are used for encoding the event name with the method
// they apply to, because we need to use a single event emitter to simulate
// multiple event emitters (because every method and submethod on our proxied
// API is an event emitter) to avoid memory leaks

/** @typedef {import('./types').MethodChain} MethodChain */

module.exports = {
  stringify,
  parse,
  isValidMethodChain,
  getMethodString,
}

const divider = '\uffff'
/**
 * @param {MethodChain} methodChain
 * @param {string} eventName
 * @returns {string}
 */
function stringify(methodChain, eventName) {
  return JSON.stringify(methodChain) + divider + eventName
}

/**
 * @param {string} string
 * @returns {[MethodChain, string]}
 */
function parse(string) {
  const [stringifiedMethodChain, eventName] = string.split(divider)
  const methodChain = JSON.parse(stringifiedMethodChain)
  if (!isValidMethodChain(methodChain)) {
    throw new SyntaxError('Cannot parse, invalid method chain')
  }
  if (typeof eventName !== 'string') {
    throw new SyntaxError('Cannot parse, invalid event name')
  }
  return [methodChain, eventName]
}

/**
 * @param {unknown} maybeMethodChain
 * @return {maybeMethodChain is MethodChain}
 */
function isValidMethodChain(maybeMethodChain) {
  return (
    Array.isArray(maybeMethodChain) &&
    maybeMethodChain.every(
      ([key, args]) =>
        typeof key === 'string' &&
        (typeof args === 'undefined' || Array.isArray(args))
    )
  )
}

/**
 * Build a string for error message
 *
 * @param {MethodChain} methodChain
 * @returns {string}
 */
function getMethodString(methodChain) {
  if (methodChain.length === 0) return '[target]'
  let result = ['[target]']
  for (const [propertyKey, args] of methodChain.slice(0, -1)) {
    if (Array.isArray(args)) {
      result.push(
        `${propertyKey}(${args.map((a) => JSON.stringify(a)).join(',')})`
      )
    } else result.push(propertyKey)
  }
  result.push(methodChain[methodChain.length - 1][0])
  return result.join('.')
}
