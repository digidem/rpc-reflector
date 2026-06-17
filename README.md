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

### `const { close } = createServer(api, channel, [options])`

`api` can be any object with any properties, methods and events that you want reflected in the client API.

`channel` can be a browser [MessagePort](http://developer.mozilla.org/en-US/docs/Web/API/MessagePort), a Node [Worker MessagePort](https://nodejs.org/api/worker_threads.html#worker_threads_class_messageport) or a MessagePort-like object that defines a `postMessage()` method and `addEventListener('message', ...)` / `removeEventListener('message', ...)` methods. The listener is called with a `MessageEvent`-like object, i.e. an object with the message on its `data` property.

If `channel` is a MessagePort you will need to manually call [`port.start()`](http://developer.mozilla.org/en-US/docs/Web/API/MessagePort/start) to start sending messages queued in the port.

`options`: an optional object with the following properties:

- `logger`: An instance of Pino Logger or a compatible logger. If not provided, no logging will be done.
- `onRequestHook: (request: MsgRequestObj, next: (request: MsgRequestObj) => Promise<any>) => void` Optional hook to observe and modify a request and its metadata, and to await the response.

`close()` is used to remove event listeners from the channel. It will not close or destroy the MessagePort used as the `channel`.

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
