// A "propArray" is an array that expresses nested props, e.g.
// myTarget.thing.method() would be expressed as ['thing', 'method']. These
// parse and stringify functions are used for encoding the event name with the
// method they apply to, because we need to use a single event emitter to
// simulate multiple event emitters (because every method and submethod on our
// proxied API is an event emitter) to avoid memory leaks

/**
 * @param {string[]} propArray
 * @param {string} eventName
 * @returns {string}
 */
export function stringify(propArray, eventName) {
  return JSON.stringify([propArray, eventName])
}

/**
 * @param {string} string
 * @returns {[string[], string]}
 */
export function parse(string) {
  const parsed = JSON.parse(string)
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    throw new SyntaxError('Cannot parse, invalid string')
  }
  const [propArray, eventName] = parsed
  if (!isStringArray(propArray)) {
    throw new SyntaxError('Cannot parse, invalid propArray')
  }
  if (typeof eventName !== 'string') {
    throw new SyntaxError('Cannot parse, invalid event name')
  }
  return [propArray, eventName]
}

/**
 * @param {unknown} maybeStringArray
 * @return {maybeStringArray is string[]}
 */
export function isStringArray(maybeStringArray) {
  return (
    Array.isArray(maybeStringArray) &&
    maybeStringArray.every((item) => typeof item === 'string')
  )
}
