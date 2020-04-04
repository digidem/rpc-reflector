// @ts-nocheck
const test = require('tape-async')
const { EventEmitter } = require('events')
const pIsPromise = require('p-is-promise')

const { CreateClient } = require('..')
const isValidMessage = require('../lib/validate-message')
const { msgType } = require('../lib/constants')
const invalidMessages = require('./fixtures/invalid-messages.json')

test('Calling method sends request message with method name at position 2 and arguments at position 3', t => {
  t.plan(6)
  function send (msg) {
    t.ok(Array.isArray(msg), 'Message is an array')
    t.ok(isValidMessage(msg), 'Message is valid')
    t.ok(typeof msg[1] === 'number', 'Message ID is a number')
    t.deepEqual(
      msg,
      [msgType.REQUEST, msg[1], 'myMethod', ['arg1', { other: 2 }]],
      'Message is expected structure'
    )
  }
  const client = CreateClient(send, new EventEmitter(), { timeout: 100 })
  const promise = client.myMethod('arg1', { other: 2 }).catch(err => {
    t.ok(/timed out/.test(err.message), 'Request times out (messages ignored)')
  })
  t.ok(pIsPromise(promise), 'returns a promise')
})

test('Calling method with no args sends request message with method name at position 2 and empty array at position 3', t => {
  t.plan(6)
  // @ts-ignore
  function send (msg) {
    t.ok(Array.isArray(msg), 'Message is an array')
    t.ok(isValidMessage(msg), 'Message is valid')
    t.ok(typeof msg[1] === 'number', 'Message ID is a number')
    t.deepEqual(
      msg,
      [msgType.REQUEST, msg[1], 'myMethod', []],
      'Message is expected structure'
    )
  }
  const client = CreateClient(send, new EventEmitter(), { timeout: 200 })
  const promise = client.myMethod().catch(err => {
    t.ok(/timed out/.test(err.message), 'Request times out (messages ignored)')
  })
  t.ok(pIsPromise(promise), 'returns a promise')
})

test('Method resolves with response on same messageId', t => {
  const receiver = new EventEmitter()
  const expectedResult = {}
  function send (msg) {
    receiver.emit('message', [msgType.RESPONSE, msg[1], null, expectedResult])
  }
  const client = CreateClient(send, receiver)
  client
    .myMethod()
    .then(v => {
      t.equal(v, expectedResult, 'Promise resolves with expected value')
      t.end()
    })
    .catch(t.fail)
})

test('Method ignores response on different messageId', t => {
  t.plan(1)
  const receiver = new EventEmitter()
  const expectedResult = {}
  // @ts-ignore
  function send (msg) {
    receiver.emit('message', [
      msgType.RESPONSE,
      Math.random(),
      null,
      expectedResult
    ])
  }
  const client = CreateClient(send, receiver, { timeout: 200 })
  client
    .myMethod()
    .then(t.fail)
    .catch(err => {
      t.ok(
        /timed out/.test(err.message),
        'Request times out (messages ignored)'
      )
    })
})

test('Throws when receiving message with errorObject', t => {
  const receiver = new EventEmitter()
  function send (msg) {
    receiver.emit('message', [msgType.RESPONSE, msg[1], { message: 'MyError' }])
  }
  const client = CreateClient(send, receiver)
  client
    .myMethod()
    .then(t.fail)
    .catch(e => {
      t.ok(e instanceof Error, 'Rejects with an Error')
      t.equal(e.message, 'MyError', 'Error message is passed through')
      t.end()
    })
})

test('Ignores invalid messages', t => {
  t.plan(1)
  const receiver = new EventEmitter()
  function send (outgoingMsg) {
    for (const msg of invalidMessages) {
      if (typeof msg[1] === 'number') {
        msg[1] = outgoingMsg[1]
      }
      receiver.emit('message', msg)
    }
  }
  const client = CreateClient(send, receiver, { timeout: 200 })
  client
    .myMethod()
    .then(t.fail)
    .catch(err => {
      t.ok(
        /timed out/.test(err.message),
        'Request times out (messages ignored)'
      )
    })
})

test('Can subscribe listeners', t => {
  const receiver = new EventEmitter()
  const expected = ['param1', { other: true }]
  let count = 0
  function send (msg) {
    t.deepEqual(msg, [msgType.ON, 'myEvent'], 'Message is expected structure')
    receiver.emit('message', [msgType.EMIT, 'myEvent', null, expected])
    setImmediate(() => {
      receiver.emit('message', [msgType.EMIT, 'myEvent', null, ['second']])
    })
  }
  const client = CreateClient(send, receiver)
  const result = client.on('myEvent', (...args) => {
    if (++count === 1) {
      t.deepEqual(args, expected, 'Arguments are emitted as expected')
      return
    }
    t.deepEqual(args, ['second'], 'Second emit as expected')
    t.end()
  })
  t.ok(result instanceof EventEmitter, 'returns an instance of EventEmitter')
  t.ok(result === client, 'Returns instance of client')
})

test('emitter.once works and sends `OFF` message', t => {
  const receiver = new EventEmitter()
  const expected = ['param1', { other: true }]
  let count = 0
  function send (msg) {
    if (count < 1) {
      t.deepEqual(msg, [msgType.ON, 'myEvent'], 'Message is expected structure')
      receiver.emit('message', [msgType.EMIT, 'myEvent', null, expected])
      return
    }
    t.deepEqual(msg, [msgType.OFF, 'myEvent'], 'Client sent OFF msg')
    t.end()
  }
  const client = CreateClient(send, receiver)
  const result = client.once('myEvent', (...args) => {
    if (++count === 1) {
      t.deepEqual(args, expected, 'Arguments are emitted as expected')
      return
    }
    t.fail('Should not be called more than once')
  })
  t.ok(result instanceof EventEmitter, 'returns an instance of EventEmitter')
  t.ok(result === client, 'Returns instance of client')
})

test('removeListener works and sends `OFF` message', t => {
  const receiver = new EventEmitter()
  const expected = ['param1', { other: true }]
  let count = 0
  function send (msg) {
    if (count < 1) {
      t.deepEqual(msg, [msgType.ON, 'myEvent'], 'Message is expected structure')
      receiver.emit('message', [msgType.EMIT, 'myEvent', null, expected])
      return
    }
    t.deepEqual(msg, [msgType.OFF, 'myEvent'], 'Client sent OFF msg')
    if (count++ === 1) {
      receiver.emit('message', [msgType.EMIT, 'myEvent', null, expected])
    } else {
      t.end()
    }
  }
  const client = CreateClient(send, receiver)
  const result = client.on('myEvent', function listener (...args) {
    setImmediate(() => client.removeListener('myEvent', listener))
    if (count++ > 0) t.fail('Should not be called more than once')
  })
  t.ok(result instanceof EventEmitter, 'returns an instance of EventEmitter')
  t.ok(result === client, 'Returns instance of client')
})
