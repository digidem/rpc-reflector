# rpc-reflector

![Node.js CI](https://github.com/gmaclennan/rpc-reflector/workflows/Node.js%20CI/badge.svg)
[![Coverage Status](https://coveralls.io/repos/github/gmaclennan/rpc-reflector/badge.svg)](https://coveralls.io/github/gmaclennan/rpc-reflector)
[![standard-readme compliant](https://img.shields.io/badge/standard--readme-OK-green.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)

> Call methods on any object over RPC with minimal fuss.

Create a "mirror" of an object on the server in the client. You can call any methods on the server object by calling the same method name on the client object. You can also subscribe to events on the client as if you were subscribing to events on the original API. Synchronous methods on the server object become asynchronous methods on the client-side. Properties on the server object become asynchronous getter methods on the client, e.g. for a server object `{ foo: 'bar' }` the property `foo` can be read on the client via `await clientApi.foo()`.

Unlike other RPC libraries, this does not require any boilerplate to define methods that are available over RPC. All methods and properties on the server object are "reflected" in client API automatically. Any method called on the client object will return a Promise, but methods that are not defined on the server will throw with a ReferenceError.

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [API](#api)
- [Maintainers](#maintainers)
- [Contributing](#contributing)
- [License](#license)

## Background

Most RPC libraries I could find require a lot of boilerplate to define the methods that are available over RPC. I wanted an easy way for an API on the server to be used from a client in exactly the same way as it is on the server, without needing to setup any RPC methods. Under-the-hood this uses a [Proxy](http://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) object.

## Install

```sh
npm install rpc-reflector
```

## Usage

```ts
import { createClient, createServer } from 'rpc-reflector'

const myApi = {
  syncMethod: () => 'result1',
  asyncMethod: () =>
    new Promise((resolve) => {
      setTimeout(() => resolve('result2'), 200)
    }),
}

const { port1: serverPort, port2: clientPort } = new MessageChannel()

const server = createServer(myApi, serverPort)

const myApiOnClient =
  /** @type {import('rpc-reflector').ClientApi<typeof myApi>} */ createClient(
    clientPort,
  )

;(async () => {
  const result1 = await myApiOnClient.syncMethod()
  const result2 = await myApiOnClient.asyncMethod()
  console.log(result1) // 'result1'
  console.log(result2) // 'result2'
  // Tear down so the MessageChannel ports stop keeping the process alive.
  createClient.close(myApiOnClient)
  server.close()
  serverPort.close()
  clientPort.close()
})()
```

## API

### `const { close, detachHandler, ensureHandler } = createServer(api, channel, [options])`

`api` can be any object with any properties, methods and events that you want reflected in the client API. It can also be a factory function that returns (or resolves to) such an object — see [Late-bound handlers](#late-bound-handlers).

`channel` can be a browser [MessagePort](http://developer.mozilla.org/en-US/docs/Web/API/MessagePort), a Node [Worker MessagePort](https://nodejs.org/api/worker_threads.html#worker_threads_class_messageport) or a MessagePort-like object that defines a `postMessage()` method and `addEventListener('message', ...)` / `removeEventListener('message', ...)` methods. The listener is called with a `MessageEvent`-like object, i.e. an object with the message on its `data` property.

If `channel` is a MessagePort you will need to manually call [`port.start()`](http://developer.mozilla.org/en-US/docs/Web/API/MessagePort/start) to start sending messages queued in the port.

`options`: an optional object with the following properties:

- `logger`: An instance of Pino Logger or a compatible logger. If not provided, no logging will be done.
- `onRequestHook: (request: MsgRequestObj, next: (request: MsgRequestObj) => Promise<any>) => void` Optional hook to observe and modify a request and its metadata, and to await the response.

`close()` is used to remove event listeners from the channel. It will not close or destroy the MessagePort used as the `channel`. For a server created with a handler factory it also detaches from the current handler and clears the subscription registry.

`detachHandler()` and `ensureHandler()` are no-ops unless the server was created with a handler factory — see [Late-bound handlers](#late-bound-handlers).

### Late-bound handlers

Instead of a handler object, `createServer` accepts a factory function `() => api | Promise<api>`. The server then treats the channel and its event subscriptions as durable, and the handler as a replaceable plug-in: clients keep calling methods and stay subscribed to events on a stable channel, while the object that actually serves them can be released and recreated behind it (e.g. a backend that is torn down when idle and rebuilt on demand).

The factory is invoked lazily: when the first message that needs a handler arrives — a method call, or an event subscription — or when `ensureHandler()` is called. Concurrent triggers share a single factory invocation. Messages that arrive while no handler is bound wait for the bind, and the server re-attaches every existing event subscription to the new handler _before_ dispatching the waiting messages, so an event caused by the very first call on a fresh handler cannot be missed. Unsubscribing from an event never invokes the factory. If the factory rejects, each waiting call rejects with that error (its `code` is preserved) and the failure is not cached — the next call retries the factory. If the factory returns the object that is already bound, nothing is re-attached.

The server object has two methods for managing the handler lifecycle (on a server created with a static handler object they are a no-op and an immediate resolve, respectively):

- `detachHandler()`: removes every listener the server attached to the current handler's emitters and releases the handler reference so it can be garbage collected. The subscription registry is kept, so when a handler is next bound the same subscriptions are re-attached to it. Idempotent.
- `ensureHandler()`: returns a promise that resolves once a handler is bound and the subscription registry is attached to it, invoking the factory if needed; rejects if the factory rejects. Resolves immediately if a handler is already bound.

A streamed response that is in flight when `detachHandler()` is called runs to completion (or error) against the old handler — it is not cancelled, so the old handler is only released once its in-flight streams end.

### `const clientApi = createClient(channel, [options])`

`channel`: see above for `createServer()`

`options`: an optional object with the following properties:

- `logger`: An instance of Pino Logger or a compatible logger. If not provided, no logging will be done.
- `onRequestHook: (request: Omit<MsgRequestObj, 'metadata'>, next: (request: MsgRequestObj) => Promise<any>) => void` Optional hook to observe and modify a request and its metadata, and to await the response.
- `timeout`: Optional timeout in milliseconds for requests. Default `5000`ms. Note that any code that takes longer than timeout will also trigger it. Use it with caution to catch timeouts in your message channel if you know your API methods will not take longer than the timeout to respond.

Returns `clientApi` which can be called with any method on the `api` passed to `createServer()`. Events on `api` can be subscribed to via `clientApi.on(eventName, handler)` on the client. Properties/fields on the server `api` can be access by calling a method with the same name on the client API, e.g. to access the property `api.myProp`, on the client call `await clientApi.myProp()`.

When using Typescript, you can pass the type of the server API as a generic e.g.

```ts
const clientApi = createClient<ServerApi>(channel)
```

The returned `clientApi` will be correctly typed, with synchronous functions converted to synchronous.

### `createClient.close(clientApi)`

The static method `close()` will remove all event listeners from the `channel` used to create the client. It will not close or destroy the MessagePort used as the `channel`.

### `createClient.rejectPending(clientApi, error)`

Rejects every in-flight method call with `error` and returns the number of calls rejected. Use this when the transport to the server has dropped (e.g. the process hosting the server was killed) and pending calls can never be answered — without it they would hang until `options.timeout`. Unlike `close()`, the client remains fully usable afterwards: new calls can be made and event listeners stay registered. A response arriving later for a rejected call is ignored.

Note that a rejected call may still have executed on the server if the request was delivered before the transport dropped — whether it is safe to retry is the caller's judgement (reads generally are; mutations need care).

No-op returning `0` if nothing is pending or the client is closed.

### `createClient.resubscribe(clientApi)`

Re-sends a subscription message to the server for every event — including events on nested sub-objects — that currently has at least one listener, and returns the number of subscription messages sent. Use this after the server has restarted: a restarted server has lost its subscription state, so it will not emit events until the client re-subscribes. Safe to call repeatedly — the server ignores duplicate subscriptions, so events are not double-delivered.

Only call this once the transport to the restarted server is connected again. Subscription messages written into a down transport are lost, and on some transports each write triggers a reconnect attempt, which can keep the transport busy while the server is still down.

No-op returning `0` if the client is closed.

### Errors

The client can reject a call with one of the following error classes. Each carries a stable `.code` property so consumers can identify it without matching against the error message. Both are exported from the package and can also be checked with `instanceof`.

| Class                | `.code`              | Thrown when                                                                                       |
| -------------------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| `ChannelClosedError` | `RPC_CHANNEL_CLOSED` | A call is in flight when the client is closed, or a method is called after the client was closed. |
| `TimeoutError`       | `RPC_TIMEOUT`        | The server does not respond within `options.timeout`.                                             |

```js
import { createClient, ChannelClosedError } from 'rpc-reflector'

try {
  await clientApi.someMethod()
} catch (err) {
  if (err instanceof ChannelClosedError) {
    // or: if (err.code === 'RPC_CHANNEL_CLOSED')
  }
}
```

## Maintainers

[@gmaclennan](https://github.com/gmaclennan)

## Contributing

PRs accepted.

Small note: If editing the README, please conform to the [standard-readme](https://github.com/RichardLitt/standard-readme) specification.

## License

MIT © 2020 Gregor MacLennan
