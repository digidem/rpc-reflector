/** @type {import('../../lib/types.js').Message[]} */
const validMessages = [
  [0, 2, ['anyMethod'], []],
  [0, 3, ['anyMethod'], ['param2', { other: 'param' }]],
  [0, 3, ['anyMethod', 'nestedMethod'], ['param2', { other: 'param' }]],
  [1, 4, null, 'returnedValue'],
  [1, 4, null, Buffer.from('returnedValue')],
  [1, 4, null, Buffer.from('returnedValue'), true],
  [1, 4, null, null, false, true],
  [1, 5, { message: 'Error message' }],
  [1, 6, null],
  [2, 'eventName', []],
  [3, 'eventName', ['method']],
  [4, 'eventName', [], null, []],
  [4, 'eventName', ['method'], null, ['param1', { other: 'param' }]],
  [4, 'eventName', [], { message: 'Error Message' }],
]

export default validMessages
