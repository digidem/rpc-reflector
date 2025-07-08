import test from 'tape'
import { parse } from '../lib/prop-array-utils.js'

const invalidStringified = [
  { foo: 'bar' },
  ['notArray', 'eventName'],
  [[4], 'eventName'],
  [['method', true], 'eventName'],
  [[]],
  [],
  [['method'], []],
  [[], true],
].map((v) => JSON.stringify(v))

const valid = [
  [[], 'eventName'],
  [['methodName'], 'eventName'],
  [['methodName', 'submethod'], 'eventName'],
]

test('Parses valid strings', (t) => {
  t.plan(valid.length)

  for (const item of valid) {
    const stringifiedItem = JSON.stringify(item)
    t.deepEqual(parse(stringifiedItem), item, 'Parses as expected')
  }
})

test('Invalid strings throw', (t) => {
  t.plan(invalidStringified.length)

  for (const str of invalidStringified) {
    t.throws(() => parse(str), 'Throws as expected')
  }
})
