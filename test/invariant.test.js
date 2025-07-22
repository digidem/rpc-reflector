import test from 'tape'
import { invariant } from '../lib/utils.js'

test('invariant', (t) => {
  t.throws(() => invariant(false), 'Throws when condition is false')
  t.throws(
    () => invariant(false, 'Custom message'),
    'Throws with custom message',
  )
  t.throws(
    () => invariant(false, () => 'Dynamic message'),
    'Throws with dynamic message function',
  )
  t.doesNotThrow(() => invariant(true), 'Does not throw when condition is true')
  t.doesNotThrow(
    () => invariant(true, 'Custom message'),
    'Does not throw with custom message when condition is true',
  )
  t.end()
})
