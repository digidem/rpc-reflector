module.exports = [
  Buffer.from('hello'),
  Uint8Array.from([1, 2]),
  [0],
  [0, 'stringID'],
  [0, 7],
  [1],
  [1, 'stringID'],
  [1, 8, 'string'],
  [2],
  [3],
  [4],
  [2, 0],
  [3, 0],
  [4, 0],
  [4, 'eventName', null, 'notArray'],
  [4, 'eventName', null, false],
  [4, 'eventName', 'notError'],
  [4, 'eventName', false],
  [5, 7],
  ['otherType'],
  'Not array',
  1,
  {},
  false
]
