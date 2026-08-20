// @ts-check
import test from 'tape'
import { EventEmitter } from 'events'

import { createClient, createServer } from '../index.js'
import { msgType } from '../lib/constants.js'
import {
  MessagePortLike,
  MessagePortLikePair,
  createTestLogger,
} from './helpers.js'

/**
 * @template {{}} ApiType
 * @typedef {import('../lib/types.js').ClientApi<ApiType>} ClientApi
 */

/** @param {number} ms */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** @param {string} name */
function createEmitterApi(name) {
  const api = Object.assign(new EventEmitter(), {
    whoami: () => name,
    /** @param {string} value */
    mutate: (value) => {
      api.emit('changed', value)
      return name
    },
  })
  return api
}

/**
 * @param {import('tape').Test} t
 * @param {import('../server.js').HandlerFactory} factory
 */
function setup(t, factory) {
  const { port1: serverPort, port2: clientPort } = new MessagePortLikePair()
  const client = /** @type {ClientApi<ReturnType<typeof createEmitterApi>>} */ (
    createClient(clientPort)
  )
  const server = createServer(factory, serverPort)
  t.teardown(() => {
    createClient.close(client)
    server.close()
  })
  return { client, server, serverPort, clientPort }
}

test('Late-bound: handler swap round-trip', async (t) => {
  const apiA = createEmitterApi('A')
  const apiB = createEmitterApi('B')
  let current = apiA
  let factoryCalls = 0
  const { client, server } = setup(t, () => {
    factoryCalls++
    return current
  })

  /** @type {string[]} */
  const received = []
  client.on('changed', (value) => received.push(value))
  t.equal(await client.whoami(), 'A', 'Call works against handler A')
  apiA.emit('changed', 'from A')
  await delay(0)
  t.deepEqual(received, ['from A'], 'Events flow from handler A')

  server.detachHandler()
  t.equal(
    apiA.listenerCount('changed'),
    0,
    'Detach removes forwarding listeners from A',
  )
  current = apiB

  t.equal(await client.whoami(), 'B', 'Next call works against handler B')
  t.equal(
    apiB.listenerCount('changed'),
    1,
    'Subscription registry re-attached to B',
  )
  apiB.emit('changed', 'from B')
  await delay(0)
  t.deepEqual(
    received,
    ['from A', 'from B'],
    'Previously-subscribed events from B are delivered',
  )
  t.equal(factoryCalls, 2, 'Factory invoked once per bind')

  server.close()
  t.equal(
    apiB.listenerCount('changed'),
    0,
    'close() detaches from the current handler',
  )
  t.end()
})

test('Late-bound: concurrent calls while unbound share one factory invocation', async (t) => {
  let factoryCalls = 0
  const { client } = setup(t, async () => {
    factoryCalls++
    await delay(10)
    return createEmitterApi('A')
  })

  const results = await Promise.all(
    Array.from({ length: 5 }, () => client.whoami()),
  )
  t.deepEqual(
    results,
    ['A', 'A', 'A', 'A', 'A'],
    'All concurrent calls resolve',
  )
  t.equal(factoryCalls, 1, 'Factory invoked exactly once')
  t.end()
})

test('Late-bound: registry is attached before awaited calls are dispatched', async (t) => {
  const { client } = setup(t, async () => {
    await delay(10)
    return createEmitterApi('A')
  })

  /** @type {string[]} */
  const received = []
  // Subscribe and call in the same tick against an unbound server. The event
  // is emitted synchronously during the call's handler execution, so it is
  // only delivered if the subscription was attached before dispatch.
  client.on('changed', (value) => received.push(value))
  await client.mutate('sync emit')
  await delay(0)
  t.deepEqual(
    received,
    ['sync emit'],
    'Event emitted synchronously during the first call is delivered',
  )
  t.end()
})

test('Late-bound: ensureHandler() resolves after registry attach', async (t) => {
  const api = createEmitterApi('A')
  let factoryCalls = 0
  const { client, server, clientPort } = setup(t, () => {
    factoryCalls++
    return api
  })

  /** @type {string[]} */
  const received = []
  client.on('changed', (value) => received.push(value))
  await client.whoami()
  t.equal(factoryCalls, 1, 'Bound after first call')

  await server.ensureHandler()
  t.equal(factoryCalls, 1, 'ensureHandler() resolves immediately when bound')

  server.detachHandler()
  /** @type {unknown[]} */
  const frames = []
  clientPort.addEventListener('message', (event) => frames.push(event.data))
  await server.ensureHandler()
  api.emit('changed', 'after ensure')
  await delay(0)
  t.equal(
    factoryCalls,
    2,
    'ensureHandler() re-invokes the factory when unbound',
  )
  t.deepEqual(received, ['after ensure'], 'Event after resolve is delivered')
  t.deepEqual(
    frames,
    [[msgType.EMIT, 'changed', [], null, ['after ensure']]],
    'Only the EMIT frame was sent — no other frames needed',
  )
  t.end()
})

test('Late-bound: ensureHandler() rejects on factory rejection without caching it', async (t) => {
  let shouldFail = true
  let factoryCalls = 0
  const { server } = setup(t, () => {
    factoryCalls++
    if (shouldFail) throw new Error('FactoryError')
    return createEmitterApi('A')
  })

  try {
    await server.ensureHandler()
    t.fail('Expected rejection')
  } catch (err) {
    t.equal(
      /** @type {Error} */ (err).message,
      'FactoryError',
      'ensureHandler() rejects with the factory error',
    )
  }
  shouldFail = false
  await server.ensureHandler()
  t.equal(factoryCalls, 2, 'The failure is not cached — the factory is retried')
  t.end()
})

test('Late-bound: factory rejection rejects awaited calls and is retried', async (t) => {
  let shouldFail = true
  let factoryCalls = 0
  const { client } = setup(t, async () => {
    factoryCalls++
    if (shouldFail) {
      throw Object.assign(new Error('BackendGone'), { code: 'EBACKENDGONE' })
    }
    return createEmitterApi('A')
  })

  try {
    await client.whoami()
    t.fail('Expected rejection')
  } catch (err) {
    t.equal(
      /** @type {Error} */ (err).message,
      'BackendGone',
      'Pending call rejects with the serialized factory error',
    )
    t.equal(
      /** @type {any} */ (err).code,
      'EBACKENDGONE',
      'Error code is preserved',
    )
  }

  shouldFail = false
  t.equal(await client.whoami(), 'A', 'Next call retries the factory and works')
  t.equal(factoryCalls, 2, 'Factory invoked again on the next trigger')
  t.end()
})

test('Late-bound: awaited subscribe is dropped with a warning when the factory rejects', async (t) => {
  t.plan(2)
  let factoryCalls = 0
  const logger = createTestLogger({
    warn(_obj, msg) {
      t.equal(
        msg,
        'Error subscribing to event (ignored)',
        'Dropped subscribe is logged',
      )
    },
  })
  const serverPort = new MessagePortLike(() => {})
  const server = createServer(
    async () => {
      factoryCalls++
      throw new Error('FactoryError')
    },
    serverPort,
    { logger },
  )
  t.teardown(() => server.close())

  serverPort.dispatchEvent(
    new MessageEvent('message', { data: [msgType.ON, 'changed', []] }),
  )
  await delay(10)
  t.equal(factoryCalls, 1, 'Factory was invoked by the subscribe')
})

test('Late-bound: re-attach failure on the new handler is logged and ignored', async (t) => {
  const apiA = createEmitterApi('A')
  const notAnEmitter = { whoami: () => 'B' }
  /** @type {import('../server.js').Handler} */
  let current = apiA
  /** @type {unknown[]} */
  const warnings = []
  const logger = createTestLogger({
    warn: (...args) => warnings.push(args),
  })
  const { port1: serverPort, port2: clientPort } = new MessagePortLikePair()
  const client = /** @type {ClientApi<typeof apiA>} */ (
    createClient(clientPort)
  )
  const server = createServer(() => current, serverPort, { logger })
  t.teardown(() => {
    createClient.close(client)
    server.close()
  })

  client.on('changed', () => {})
  await client.whoami()
  t.equal(apiA.listenerCount('changed'), 1, 'Subscribed on handler A')

  server.detachHandler()
  current = notAnEmitter
  await server.ensureHandler()
  t.equal(warnings.length, 1, 'Failed re-attach is logged')
  t.equal(
    await client.whoami(),
    'B',
    'Calls still work on a handler without the emitter',
  )
  t.end()
})

test('Late-bound: unsubscribing while unbound does not invoke the factory', async (t) => {
  let factoryCalls = 0
  const api = createEmitterApi('A')
  const serverPort = new MessagePortLike(() => {})
  const server = createServer(() => {
    factoryCalls++
    return api
  }, serverPort)
  t.teardown(() => server.close())

  serverPort.dispatchEvent(
    new MessageEvent('message', { data: [msgType.OFF, 'changed', []] }),
  )
  await delay(10)
  t.equal(factoryCalls, 0, 'OFF with an empty registry does not bind')

  // A subscription left in the registry from a previous bind is also removed
  // registry-only: after a later bind it must not be re-attached.
  serverPort.dispatchEvent(
    new MessageEvent('message', { data: [msgType.ON, 'changed', []] }),
  )
  await delay(10)
  t.equal(factoryCalls, 1, 'Subscribing binds a handler')
  t.equal(api.listenerCount('changed'), 1, 'Subscribed on the handler')

  server.detachHandler()
  serverPort.dispatchEvent(
    new MessageEvent('message', { data: [msgType.OFF, 'changed', []] }),
  )
  await delay(10)
  t.equal(factoryCalls, 1, 'OFF while unbound does not invoke the factory')

  await server.ensureHandler()
  t.equal(
    api.listenerCount('changed'),
    0,
    'Registry-only removal: subscription is not re-attached on the next bind',
  )
  t.end()
})

test('Late-bound: detach during a pending bind discards the stale bind', async (t) => {
  const apiA = createEmitterApi('A')
  const apiB = createEmitterApi('B')
  /** @type {(api: ReturnType<typeof createEmitterApi>) => void} */
  let resolveFactory = () => {}
  let factoryCalls = 0
  const { client, server } = setup(t, () => {
    factoryCalls++
    if (factoryCalls === 1) {
      return new Promise((resolve) => {
        resolveFactory = resolve
      })
    }
    return apiB
  })

  /** @type {string[]} */
  const received = []
  client.on('changed', (value) => received.push(value))
  const pendingCall = client.whoami()
  // The factory is invoked in a microtask, so wait a tick for the bind to be
  // in flight before detaching mid-bind.
  await delay(0)
  t.equal(factoryCalls, 1, 'Factory invoked by the awaited frames')

  server.detachHandler()
  resolveFactory(apiA)

  t.equal(await pendingCall, 'B', 'Awaited call re-triggers a fresh bind')
  t.equal(factoryCalls, 2, 'Fresh bind invoked the factory again')
  t.equal(apiA.listenerCount('changed'), 0, 'Stale bind did not attach to A')
  t.equal(apiB.listenerCount('changed'), 1, 'Fresh bind attached to B')
  apiB.emit('changed', 'from B')
  await delay(0)
  t.deepEqual(
    received,
    ['from B'],
    'Events flow from the freshly bound handler',
  )
  t.end()
})

test('Late-bound: factory returning the same object never re-attaches', async (t) => {
  const api = createEmitterApi('A')
  let onCalls = 0
  const originalOn = api.on.bind(api)
  api.on = (eventName, listener) => {
    onCalls++
    return originalOn(eventName, listener)
  }
  let factoryCalls = 0
  const { client, server } = setup(t, () => {
    factoryCalls++
    return api
  })

  client.on('changed', () => {})
  await client.whoami()
  t.equal(onCalls, 1, 'Subscription attached once on first bind')

  await server.ensureHandler()
  await server.ensureHandler()
  await client.whoami()
  t.equal(factoryCalls, 1, 'Factory not re-invoked while bound')
  t.equal(onCalls, 1, 'No re-attach while the same handler stays bound')

  // Detach/re-bind cycles with the same object must pair every attach with a
  // detach so listeners never accumulate.
  for (let i = 0; i < 3; i++) {
    server.detachHandler()
    await server.ensureHandler()
    t.equal(api.listenerCount('changed'), 1, 'Listeners do not accumulate')
  }
  t.equal(factoryCalls, 4, 'Factory invoked once per re-bind')
  t.end()
})

test('Late-bound: no reserved names on static handlers', async (t) => {
  const staticApi = {
    resolveHandler: () => 'a',
    detachHandler: () => 'b',
    ensureHandler: () => 'c',
  }
  const { port1: serverPort, port2: clientPort } = new MessagePortLikePair()
  const client = /** @type {ClientApi<typeof staticApi>} */ (
    createClient(clientPort)
  )
  const server = createServer(staticApi, serverPort)
  t.teardown(() => {
    createClient.close(client)
    server.close()
  })

  t.equal(await client.resolveHandler(), 'a', 'resolveHandler reflects')
  t.equal(await client.detachHandler(), 'b', 'detachHandler reflects')
  t.equal(await client.ensureHandler(), 'c', 'ensureHandler reflects')

  server.detachHandler()
  await server.ensureHandler()
  t.equal(
    await client.resolveHandler(),
    'a',
    'Server detachHandler()/ensureHandler() are no-ops for a static handler',
  )
  t.end()
})

test('Late-bound: detachHandler() releases the handler reference', async (t) => {
  /** @type {WeakRef<object> | undefined} */
  let handlerRef
  let strongApi = createEmitterApi('A')
  const { client, server } = setup(t, () => {
    handlerRef = new WeakRef(strongApi)
    return strongApi
  })

  client.on('changed', () => {})
  t.equal(await client.whoami(), 'A', 'Call works while bound')
  t.equal(strongApi.listenerCount('changed'), 1, 'Listener attached')

  server.detachHandler()
  server.detachHandler()
  t.equal(
    strongApi.listenerCount('changed'),
    0,
    'No listeners left on the old handler (detach is idempotent)',
  )

  // Only the WeakRef should be left holding the old handler.
  strongApi = createEmitterApi('B')
  if (typeof global.gc === 'function') {
    global.gc()
    await delay(10)
    global.gc()
    t.equal(
      handlerRef && handlerRef.deref(),
      undefined,
      'Old handler is garbage collected after detach',
    )
  } else {
    t.pass('global.gc not available (run with --expose-gc for the GC check)')
  }
  t.end()
})
