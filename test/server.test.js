// @ts-nocheck
const test = require('tape-async')
const { EventEmitter } = require('events')

const { CreateServer } = require('..')
const invalidMessages = require('./fixtures/invalid-messages.json')

test('Ignores invalid messages', t => {
  t.plan(1)
  const receiver = new EventEmitter()
  function send () {
    t.fail('Should ignore all invalid messages')
  }
  CreateServer({}, send, receiver)
  for (const msg of invalidMessages) {
    receiver.emit('message', msg)
  }
  t.pass('Ignored all invalid messages')
})
