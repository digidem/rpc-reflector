const test = require('tape')
const isValidMessage = require('../lib/validate-message')
const { msgType } = require('../lib/constants')

const validMessages = [
  [msgType.REQUEST, 2, 'anyMethod'],
  [msgType.REQUEST, 3, 'anyMethod', ['param2', { other: 'param' }]],
  [msgType.RESPONSE, 4, null, 'returnedValue'],
  [msgType.RESPONSE, 5, { message: 'Error message' }],
  [msgType.RESPONSE, 6, null],
  [msgType.ON, 'eventName'],
  [msgType.OFF, 'eventName'],
  [msgType.EMIT, 'eventName'],
  [msgType.EMIT, 'eventName', ['param1', { other: 'param' }]]
]

const invalidMessages = [
  [msgType.REQUEST], // Missing items
  [msgType.REQUEST, 'stringID'], // invalid ID
  [msgType.REQUEST, 7], // Missing method name
  [msgType.RESPONSE],
  [msgType.RESPONSE, 'stringID'],
  [msgType.RESPONSE, 8, 'string'],
  [msgType.ON],
  [msgType.OFF],
  [msgType.EMIT],
  [msgType.ON, 0],
  [msgType.OFF, 0],
  [msgType.EMIT, 0],
  [msgType.EMIT, 'eventName', 'notArray'],
  [msgType.EMIT, 'eventName', false],
  ['otherType']
]

test('Valid messages return true', t => {
  for (const msg of validMessages) {
    t.ok(isValidMessage(msg), `Message \`${JSON.stringify(msg)}\` is valid`)
  }
  t.end()
})

test('Invalid mesages return false', t => {
  for (const msg of invalidMessages) {
    t.false(
      isValidMessage(msg),
      `Message \`${JSON.stringify(msg)}\` is invalid`
    )
  }
  t.end()
})
