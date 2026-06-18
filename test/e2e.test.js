// @ts-check
import test from 'tape'
import { createClient, createServer, TimeoutError } from '../index.js'
import { EventEmitter } from 'events'
import { EventEmitter as EventEmitter3 } from 'eventemitter3'
import { readFileSync, createReadStream } from 'fs'
import { join } from 'path'
import intoStream from 'into-stream'
import { MessagePortLikePair, ReadableError } from './helpers.js'
import ensureError from 'ensure-error'
import { fileURLToPath } from 'url'
import path from 'path'
import { pino } from 'pino'
import { isReadableStream } from 'is-stream'
import nullLogger from 'abstract-logging'
import { isErrorWithCode } from 'custom-error-creator'

/** @import {MessagePortLike} from '../index.js' */
/**
 * @template {{}} ApiType
 * @typedef {import('../lib/types.js').ClientApi<ApiType>} ClientApi
 */

const fixturePath = join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/lorem.txt',
)
const fixtureBuf = readFileSync(fixturePath)
const objectsFixture = fixtureBuf
  .toString()
  .split(' ')
  .map((text) => ({ text }))

const myApi = {
  /**
   * @param {number} a
   * @param {number} b
   */
  add(a, b) {
    return a + b
  },
  /** @param {any} value */
  echo(value) {
    return value
  },
  prop: 'foo',
  objectProp: {
    foo: 'bar',
  },
  arrayProp: [1, 2, 3],
  booleanProp: true,
  symbolProp: Symbol('foo'),
  nullProp: null,
  undefinedProp: undefined,
  numberProp: 42,
  namespace: {
    /**
     * @param {number} a
     * @param {number} b
     */
    sub(a, b) {
      return a - b
    },
    prop: 'bar',
  },
  deep: {
    nested: {
      /**
       * @param {number} a
       * @param {number} b
       */
      mult(a, b) {
        return a * b
      },
    },
  },
  async getLlama() {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve('llama')
      }, 200)
    })
  },
  async errorMethod() {
    return Promise.reject(new Error('TestError'))
  },
  createErrorStream() {
    return new ReadableError(new Error('TestError'))
  },
  createStringStream() {
    // Set highWaterMark to force chunking to ensure that concat works on client
    // (each chunk is sent as a separate message)
    return createReadStream(fixturePath, {
      highWaterMark: 10,
      encoding: 'utf8',
    })
  },
  createBufferStream() {
    // Set highWaterMark to force chunking to ensure that concat works on client
    // (each chunk is sent as a separate message)
    return createReadStream(fixturePath, { highWaterMark: 10 })
  },
  /** @param {object} o */
  createObjectStream(o) {
    return intoStream.object(o)
  },
  async promiseReturningStream() {
    return createReadStream(fixturePath, {
      highWaterMark: 10,
      encoding: 'utf8',
    })
  },
  slowMethod() {
    return new Promise(() => {})
  },
}

/** @returns {Exclude<Parameters<typeof createClient>[1], undefined>['logger']} */
function makeLogger() {
  if (!process.env.DEBUG) return false
  return pino({
    level: 'debug',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'pid,hostname',
      },
    },
  })
}

// Run tests with MessagePort
runTests(function setup(t, api, clientOpts, serverOpts) {
  const { port1: serverMPort, port2: clientMPort } = new MessageChannel()
  const logger = makeLogger()
  const client = /** @type {ClientApi<typeof api>} */ (
    createClient(clientMPort, { logger, ...clientOpts })
  )
  const server = createServer(api, serverMPort, { logger, ...serverOpts })
  // A real MessageChannel keeps the event loop alive while a port has an active
  // 'message' listener. Closing the client and server removes those listeners
  // (so the process can exit) and rejects any in-flight requests instead of
  // letting them hang to the timeout. Then close the ports to free them.
  t.teardown(() => {
    createClient.close(client)
    server.close()
    clientMPort.close()
    serverMPort.close()
  })
  return { client, server, clientMPort, serverMPort }
})

// Run tests with MessagePort-like objects
runTests(function setup(t, api, clientOpts, serverOpts) {
  const { port1: serverMPort, port2: clientMPort } = new MessagePortLikePair()
  const logger = makeLogger()
  const client = /** @type {ClientApi<typeof api>} */ (
    createClient(clientMPort, { logger, ...clientOpts })
  )
  const server = createServer(api, serverMPort, { logger, ...serverOpts })
  // The fake doesn't hold the event loop open, but close the client and server
  // anyway to detach listeners and reject any in-flight requests.
  t.teardown(() => {
    createClient.close(client)
    server.close()
  })
  return { client, server, clientMPort, serverMPort }
})

/**
 * @typedef {<T extends {}>(t: import('tape').Test, api: T, clientOpts?: Parameters<typeof createClient>[1], serverOpts?: Parameters<typeof createServer>[2]) => { client: ClientApi<T>, server: ReturnType<typeof createServer>, clientMPort: MessagePortLike, serverMPort: MessagePortLike }} SetupFunction
 */

/**
 * @param {SetupFunction} setup
 */
function runTests(setup) {
  test('Client is instance of EventEmitter3', (t) => {
    const { client } = setup(t, myApi)
    t.ok(client instanceof EventEmitter3)
    t.end()
  })

  test('non-MessagePort arg throws', (t) => {
    // @ts-expect-error
    t.throws(() => createClient({}), 'Throws when no MessagePort is passed')
    t.throws(
      // @ts-expect-error
      () => createServer({}, {}),
      'Throws when no MessagePort is passed to server',
    )
    // @ts-expect-error
    t.throws(() => createClient(null), 'Throws for null')
    // @ts-expect-error
    t.throws(() => createClient(1), 'Throws for non-object')
    t.end()
  })

  test('Payloads containing `data`/`value` keys round-trip intact', async (t) => {
    const { client } = setup(t, myApi)
    // These keys collide with the transport envelope (`data`) and the metadata
    // container (`value`); they must survive because payloads always travel
    // nested inside the message, never as the top-level transport value.
    const payload = {
      data: 'should-not-be-unwrapped',
      value: 42,
      nested: { data: [1, 2, 3], value: { deep: true } },
    }
    t.deepEqual(
      await client.echo(payload),
      payload,
      'object with `data` and `value` keys is returned unchanged',
    )
    t.deepEqual(
      await client.echo({ data: { value: 'x' } }),
      { data: { value: 'x' } },
      'object that looks exactly like a wrapped container is returned unchanged',
    )
    t.end()
  })

  test('Calls methods on server', async (t) => {
    const { client } = setup(t, myApi)
    t.plan(10)
    t.equal(await client.add(1, 2), 3, 'Sync method works')
    t.equal(await client.getLlama(), 'llama', 'Async method works')
    t.equal(
      await client.createStringStream(),
      fixtureBuf.toString(),
      'Readable stream as string works',
    )
    t.equal(
      await client.promiseReturningStream(),
      fixtureBuf.toString(),
      'Promise returning readable stream as string works',
    )
    t.ok(
      fixtureBuf.equals(
        // I have not found an easy way to automatically type the return type of streams
        /** @type {Uint8Array} */ (await client.createBufferStream()),
      ),
      'Readable buffer works',
    )
    t.deepEqual(
      await client.createObjectStream(objectsFixture),
      objectsFixture,
      'Readable stream as object works',
    )
    const arrayOfStrings = objectsFixture.toString().split(' ')
    t.deepEqual(
      await client.createObjectStream(arrayOfStrings),
      arrayOfStrings,
      'An object stream returns as an array of chunks, not as a concatenated string',
    )
    const arrayOfBuffers = objectsFixture
      .toString()
      .split(' ')
      .map((s) => new Uint8Array(Buffer.from(s)))
    t.deepEqual(
      await client.createObjectStream(arrayOfBuffers),
      arrayOfBuffers,
      'An object stream returns as an array of chunks, not as a concatenated buffer',
    )
    try {
      await client.errorMethod()
      t.fail('Should not reach here')
    } catch (err) {
      t.equal(
        ensureError(err).message,
        'TestError',
        'Error from server is passed to client',
      )
    }
    try {
      await client.createErrorStream()
      t.fail('Should not reach here')
    } catch (err) {
      t.equal(
        ensureError(err).message,
        'TestError',
        'Error from server stream is passed to client',
      )
    }
  })

  test('Nested methods', async (t) => {
    const { client } = setup(t, myApi)
    t.plan(10)
    t.equal(await client.namespace.sub(5, 2), 3, 'nested method works')
    t.equal(await client.deep.nested.mult(2, 3), 6, 'deep nested works')
    try {
      // @ts-expect-error
      await client.namespace.missingMethod('donkey?')
      t.fail('Should not get here')
    } catch (error) {
      t.true(error instanceof Error, 'Calling missing method threw')
      t.equal(
        ensureError(error).message,
        'missingMethod is not defined',
        'Error message as expected',
      )
    }
    try {
      // @ts-expect-error
      await client.deep.missingNameSpace.sub('donkey?')
      t.fail('Should not get here')
    } catch (error) {
      t.true(error instanceof Error, 'Calling with missing namespace threw')
      t.equal(
        ensureError(error).message,
        'missingNameSpace is not defined',
        'Error message as expected',
      )
    }
    try {
      let horse
      // Need to await this separately, because otherwise the rejection is not caught
      try {
        // @ts-expect-error
        horse = await client.deep.missingNameSpace('horse')
      } catch {
        // ignore error
      }
      await horse.sub('donkey?')
      t.fail('Should not get here')
    } catch (error) {
      t.ok(error instanceof Error, 'Calling with missing namespace threw')
      t.ok(
        ensureError(error).message.match('undefined'),
        'Error message as expected',
      )
    }
    try {
      // @ts-expect-error
      await client.prop.oops('donkey?')
      t.fail('Should not get here')
    } catch (error) {
      t.ok(error instanceof Error, 'Calling method on prop fails')
      t.equal(
        ensureError(error).message,
        'oops is not defined',
        'Error message as expected',
      )
    }
  })

  test('Calling non-existent methods rejects with error', async (t) => {
    const { client } = setup(t, myApi)

    try {
      // @ts-expect-error
      await client.missingMethod('donkey?')
      t.fail('Should not get here')
    } catch (error) {
      t.true(error instanceof Error, 'Threw with error')
      t.equal(
        ensureError(error).message,
        'missingMethod is not defined',
        'Error message as expected',
      )
    }
    t.end()
  })

  test('Closed server does not respond, client times out', async (t) => {
    const { client, server } = setup(t, myApi, { timeout: 200 })
    server.close()
    try {
      await client.add(1, 2)
    } catch (error) {
      t.true(error instanceof TimeoutError, 'Threw with a TimeoutError')
      t.equal(
        /** @type {any} */ (error).code,
        'RPC_TIMEOUT',
        'Error has a stable RPC_TIMEOUT code',
      )
      t.true(
        ensureError(error).message.includes('200ms'),
        'Error message includes the configured timeout',
      )
    }
    t.end()
  })

  /** @type {['prop',
    'objectProp',
    'arrayProp',
    'booleanProp',
    'nullProp',
    'undefinedProp',
    'numberProp'
  ]} */
  const transferrableProps = [
    'prop',
    'objectProp',
    'arrayProp',
    'booleanProp',
    'nullProp',
    'undefinedProp',
    'numberProp',
  ]

  test('Properties can be accessed as async functions', async (t) => {
    const { client } = setup(t, myApi)
    t.plan(transferrableProps.length)
    for (const prop of transferrableProps) {
      t.deepEqual(
        await client[prop](),
        myApi[prop],
        'property returns promise that resolves to property value',
      )
    }
  })

  test('Cannot call non-existent methods on properties', async (t) => {
    const { client } = setup(t, myApi)
    t.plan(transferrableProps.length)
    for (const prop of transferrableProps) {
      try {
        t.deepEqual(
          // @ts-expect-error
          await client[prop].missingMethod(),
          myApi[prop],
          'property returns promise that resolves to property value',
        )
        t.fail('Should not get here')
      } catch (error) {
        t.true(error instanceof Error, 'Threw with error')
      }
    }
  })

  test('Nested properties can be accessed as async functions', async (t) => {
    const { client } = setup(t, myApi)
    t.equal(await client.namespace.prop(), 'bar', 'nested property works')
    t.end()
  })

  test('Attempting to access a symbol property throws an error', async (t) => {
    const { client } = setup(t, myApi)
    t.plan(2)
    try {
      // @ts-expect-error
      await client.symbolProp()
      t.fail('Should not get here')
    } catch (error) {
      t.true(error instanceof Error, 'Threw with error')
      t.equal(
        ensureError(error).message,
        "Property 'symbolProp' is a Symbol",
        'Error message as expected',
      )
    }
  })

  test('The server ignores subscribe and unsubscribe when handler is not an EventEmitter', (t) => {
    const { client } = setup(t, {})
    // @ts-expect-error
    client.on('myEvent', t.fail)
    // @ts-expect-error
    client.off('myEvent', t.fail)
    // @ts-expect-error
    client.namespace.on('myEvent', t.fail)
    // @ts-expect-error
    client.namespace.off('myEvent', t.fail)
    setTimeout(t.end, 200)
  })

  test('Subscribes to events on server', (t) => {
    const emitterApi = new EventEmitter()
    const { client } = setup(t, emitterApi)
    const expected = ['param1', { other: true }]
    client.on('myEvent', (...args) => {
      t.deepEqual(args, expected)
      t.end()
    })
    whenServerSubscribed(emitterApi, 'myEvent', () => {
      emitterApi.emit.apply(emitterApi, ['myEvent', ...expected])
    })
  })

  test('Nested props are emitters', (t) => {
    t.plan(2)
    const emitterApi = new EventEmitter()
    const { client } = setup(t, { namespace: emitterApi })
    const expected = ['param1', { other: true }]
    t.true(
      client.namespace instanceof EventEmitter3,
      'nested prop is an event emitter',
    )
    client.namespace.on('myEvent', (...args) => {
      t.deepEqual(args, expected)
      t.end()
    })
    whenServerSubscribed(emitterApi, 'myEvent', () => {
      emitterApi.emit.apply(emitterApi, ['myEvent', ...expected])
    })
  })

  test('Unsubscribes to events', (t) => {
    const emitterApi = new EventEmitter()
    const { client } = setup(t, emitterApi)
    let count = 0

    client.on('myEvent', function listener(...args) {
      if (count++ > 0) return t.fail('Called more than once')
      t.deepEqual(args, ['carrot'], 'Listener called with correct args')
      client.off('myEvent', listener)
      // The client listener is removed now, so a second emit must not reach it.
      emitterApi.emit('myEvent', 'carrot')
      setTimeout(t.end, 200)
    })

    whenServerSubscribed(emitterApi, 'myEvent', () => {
      emitterApi.emit('myEvent', 'carrot')
    })
  })

  test('Removing a listener when one still exists does not unsubscribe', (t) => {
    const emitterApi = new EventEmitter()
    const { client } = setup(t, emitterApi)
    let count1 = 0
    let count2 = 0

    client.on('myEvent', function listener1(...args) {
      if (count1++ > 0) return t.fail('Called more than once')
      t.deepEqual(args, ['carrot'])
      client.off('myEvent', listener1)
    })

    client.on('myEvent', function listener2() {
      if (count2++ === 0) {
        // listener1 has just removed itself but listener2 keeps the server
        // subscribed, so a second emit must still reach listener2.
        emitterApi.emit('myEvent', 'carrot')
        return
      }
      t.equal(count2, 2, 'Second listener was called twice')
      setTimeout(t.end, 200)
    })

    whenServerSubscribed(emitterApi, 'myEvent', () => {
      emitterApi.emit('myEvent', 'carrot')
    })
  })

  test('Error events pass error object', (t) => {
    t.plan(2)
    const emitterApi = new EventEmitter()
    const { client } = setup(t, emitterApi)
    const expected = new Error('TestError')
    client.on('error', (error) => {
      t.ok(error instanceof Error, 'Error object is returned')
      t.equal(error.message, 'TestError', 'Error message is valid')
    })
    whenServerSubscribed(emitterApi, 'error', () => {
      emitterApi.emit.apply(emitterApi, ['error', expected])
    })
  })

  test('once works', (t) => {
    const emitterApi = new EventEmitter()
    const { client } = setup(t, emitterApi)
    let count = 0

    client.once('myEvent', function listener(...args) {
      if (count++ > 0) return t.fail('Called more than once')
      t.deepEqual(args, ['carrot'])
      // `once` has removed the client listener and told the server to
      // unsubscribe; a second emit must not reach it, and once the OFF has been
      // processed the server should have no listeners left.
      emitterApi.emit('myEvent', 'carrot')
      setTimeout(() => {
        t.equal(
          emitterApi.eventNames().length,
          0,
          'No more listeners on server',
        )
        t.end()
      }, 200)
    })

    whenServerSubscribed(emitterApi, 'myEvent', () => {
      emitterApi.emit('myEvent', 'carrot')
    })
  })

  test('Other EventEmitter methods work', (t) => {
    const emitterApi = new EventEmitter()
    const { client } = setup(t, emitterApi)
    const noop = () => {}
    client.on('myEvent', noop)
    t.deepEqual(client.eventNames(), ['myEvent'])
    // t.equal(
    //   client.getMaxListeners(),
    //   emitterApi.getMaxListeners(),
    //   'getMaxListeners() works'
    // )
    // client.setMaxListeners(5)
    // t.equal(client.getMaxListeners(), 5)
    // t.equal(client.rawListeners('myEvent')[0], noop)
    t.end()
  })

  test('eventNames() is scoped to the sub-client it is called on', (t) => {
    const fooEmitter = new EventEmitter()
    const barEmitter = new EventEmitter()
    const { client } = setup(t, { foo: fooEmitter, bar: barEmitter })
    client.foo.on('eventA', () => {})
    client.bar.on('eventB', () => {})
    // `foo` and `bar` are different prop arrays of the same length, so filtering
    // each sub-client's events compares them element by element.
    t.deepEqual(client.foo.eventNames(), ['eventA'], 'Only foo events returned')
    t.deepEqual(client.bar.eventNames(), ['eventB'], 'Only bar events returned')
    t.end()
  })

  test('Closing server removes event listeners on server', (t) => {
    const emitterApi = new EventEmitter()
    const { client, server } = setup(t, emitterApi)

    client.on('myEvent', () => {})
    client.on('otherEvent', () => {})

    setTimeout(() => {
      t.equal(emitterApi.eventNames().length, 2)
      server.close()
      t.equal(emitterApi.eventNames().length, 0)
      t.end()
    }, 200)
  })

  test('Closing server removes nested event listeners on server', (t) => {
    const emitterApi = new EventEmitter()
    const { client, server } = setup(t, {
      nested: emitterApi,
    })

    client.nested.on('myEvent', () => {})
    client.nested.on('otherEvent', () => {})

    setTimeout(() => {
      t.equal(emitterApi.eventNames().length, 2)
      server.close()
      t.equal(emitterApi.eventNames().length, 0)
      t.end()
    }, 200)
  })

  test('Closing the client stops it receiving messages from server', async (t) => {
    const { client } = setup(t, myApi, { timeout: 100 })
    t.equal(await client.add(1, 2), 3, 'Sync method works')
    createClient.close(client)
    try {
      await client.add(1, 2)
    } catch (err) {
      if (!isErrorWithCode(err))
        return t.fail('Error does not have a code property')
      t.equal(
        err.code,
        'RPC_CHANNEL_CLOSED',
        'Error has a stable RPC_CHANNEL_CLOSED code',
      )
    }
    t.end()
  })

  test('Closing the client rejects in-flight requests with "Channel closed"', async (t) => {
    const { client } = setup(t, myApi, { timeout: 5000 })
    const inFlight = client.slowMethod()
    createClient.close(client)
    const guard = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('test guard timed out')), 500),
    )
    try {
      await Promise.race([inFlight, guard])
      t.fail('Expected rejection')
    } catch (err) {
      if (!isErrorWithCode(err))
        return t.fail('Error does not have a code property')
      t.equal(
        err.code,
        'RPC_CHANNEL_CLOSED',
        'Error has a stable RPC_CHANNEL_CLOSED code',
      )
    }
    t.end()
  })

  test('Non-string methods / props are not supported', (t) => {
    const { client } = setup(t, myApi)
    // @ts-expect-error
    t.throws(() => client[Symbol('test')](), 'Calling a symbol method throws')
    t.end()
  })

  test('Accessing a symbol property returns undefined', (t) => {
    const { client } = setup(t, myApi)
    t.equal(
      // @ts-expect-error
      client[Symbol('test')],
      undefined,
      'Symbol property returns undefined',
    )
    t.end()
  })

  test('console.log on client does not throw', (t) => {
    const { client } = setup(t, myApi)
    // This was throwing without a trap for util.inspect.custom
    t.doesNotThrow(() => console.log(client))
    t.doesNotThrow(() => console.log(client.add))
    const pending = client.add(1, 2)
    // The result is irrelevant; swallow it so this fire-and-forget request
    // doesn't reject unhandled when the channel is torn down.
    pending.catch(() => {})
    t.doesNotThrow(() => console.log(pending))
    t.end()
  })

  test('client properties are stable', (t) => {
    // If we don't cache the proxy returned by accessing a property like
    // `client.namespace`, then each time you access it a new Proxy will be
    // created.
    const { client } = setup(t, myApi)
    t.is(client.namespace, client.namespace)
    t.is(client.deep.nested, client.deep.nested)
    t.end()
  })

  test('Can await client and subclients', async (t) => {
    const { client } = setup(t, myApi)
    t.is(await client, client, 'Same object is returned when awaiting')
    t.is(await client.deep, client.deep)
    t.is(await client.deep.nested, client.deep.nested)
    t.end()
  })

  test('Client onRequestHook', async (t) => {
    const { client } = setup(t, myApi, {
      onRequestHook: async (request, next) => {
        t.deepEqual(
          request.method,
          ['add'],
          'onRequestHook called with correct method',
        )
        t.deepEqual(
          request.args,
          [1, 2],
          'onRequestHook called with correct args',
        )
        const result = next(request)
        t.equal(await result, 3, 'onRequestHook returns correct result')
      },
    })
    t.plan(4)
    t.equal(await client.add(1, 2), 3, 'Sync method works')
  })

  test('Client onRequestHook - methods throw in hook', async (t) => {
    const { client } = setup(t, myApi, {
      onRequestHook: async (request, next) => {
        const result = next(request)
        try {
          await result
          t.fail('onRequestHook should not return a result')
        } catch (/** @type {any} */ err) {
          t.equal(
            err.message,
            'TestError',
            'Error in promise returned from next() is not swallowed',
          )
        }
      },
    })
    t.plan(2)
    try {
      await client.errorMethod()
      t.fail('Should not reach here')
    } catch (/** @type {any} */ err) {
      t.equal(err.message, 'TestError', 'Error in method is thrown')
    }
  })

  test('Server onRequestHook', async (t) => {
    const { client, server } = setup(t, myApi, undefined, {
      onRequestHook: async (request, next) => {
        t.deepEqual(
          request.method,
          ['add'],
          'onRequestHook called with correct method',
        )
        t.deepEqual(
          request.args,
          [1, 2],
          'onRequestHook called with correct args',
        )
        const result = next(request)
        t.equal(await result, 3, 'onRequestHook returns correct result')
      },
    })
    t.plan(4)
    t.equal(await client.add(1, 2), 3, 'Sync method works')
    server.close()
  })

  test('Server onRequestHook - stream result', async (t) => {
    const { client, server } = setup(t, myApi, undefined, {
      onRequestHook: async (request, next) => {
        t.deepEqual(
          request.method,
          ['createStringStream'],
          'onRequestHook called with correct method',
        )
        t.deepEqual(request.args, [], 'onRequestHook called with correct args')
        const result = next(request)
        t.ok(isReadableStream(result), 'onRequestHook returns stream')
      },
    })
    t.plan(4)
    t.equal(
      await client.createStringStream(),
      fixtureBuf.toString(),
      'Sync method works',
    )
    server.close()
  })

  test('Passing metadata with onRequestHooks', async (t) => {
    const { client } = setup(
      t,
      myApi,
      {
        onRequestHook: async (request, next) => {
          return next({
            ...request,
            metadata: { foo: 'bar' },
          })
        },
      },
      {
        onRequestHook: async (request, next) => {
          t.deepEqual(
            request.metadata,
            { foo: 'bar' },
            'onRequestHook called with correct metadata',
          )
          return next(request)
        },
      },
    )
    t.plan(2)
    const result = await client.add(1, 2)
    t.equal(result, 3, 'Expected result from add method')
  })

  test('Invalid metadata is ignored', async (t) => {
    const { client } = setup(
      t,
      myApi,
      {
        onRequestHook: async (request, next) => {
          return next({
            ...request,
            // @ts-expect-error
            metadata: { foo: 'bar', baz: 42 }, // Invalid metadata
          })
        },
      },
      {
        onRequestHook: async (request, next) => {
          t.equal(request.metadata, undefined, 'invalid metadata is ignored')
          return next(request)
        },
      },
    )
    t.plan(2)
    try {
      await client.add(1, 2)
      t.pass('Invalid metadata does not throw')
    } catch {
      t.fail('Invalid metadata should not throw')
    }
  })

  test('Error in onRequestHook is ignored', async (t) => {
    const clientHookError = new Error('Test error in client onRequestHook')
    const serverHookError = new Error('Test error in server onRequestHook')
    const clientLogger = {
      ...nullLogger,
      msgPrefix: undefined,
      // @ts-ignore
      error(obj) {
        t.equal(obj.err, clientHookError, 'Client hook error logged')
      },
    }

    const serverLogger = {
      ...nullLogger,
      msgPrefix: undefined,
      // @ts-ignore
      error(obj) {
        t.equal(obj.err, serverHookError, 'Server hook error logged')
      },
    }

    const { client } = setup(
      t,
      myApi,
      {
        logger: clientLogger,
        onRequestHook: () => {
          throw clientHookError
        },
      },
      {
        logger: serverLogger,
        onRequestHook: () => {
          throw serverHookError
        },
      },
    )
    t.plan(3)
    const result = await client.add(1, 2)
    t.equal(result, 3, 'Expected result from add method')
  })
}

/**
 * Run `fn` once the server has subscribed to `eventName` on `emitter`. Emitting
 * any earlier races ahead of the server attaching its listener and the event is
 * lost. Transports deliver the client's subscribe message with different timing:
 * a real MessageChannel is asynchronous (the server subscribes after `client.on`
 * returns), while the MessagePort-like fake is synchronous (it subscribes during
 * `client.on`). Handle both: if the server is already subscribed, emit on the
 * next tick; otherwise wait for the `newListener` it fires when it subscribes.
 *
 * @param {import('events').EventEmitter} emitter
 * @param {string} eventName
 * @param {() => void} fn
 */
function whenServerSubscribed(emitter, eventName, fn) {
  if (emitter.listenerCount(eventName) > 0) {
    process.nextTick(fn)
    return
  }
  emitter.on('newListener', function onAdd(name) {
    if (name !== eventName) return
    emitter.removeListener('newListener', onAdd)
    process.nextTick(fn)
  })
}
