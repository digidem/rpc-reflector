# rpc-reflector

[![standard-readme compliant](https://img.shields.io/badge/standard--readme-OK-green.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)

Call methods on any object over RPC with minimal fuss.

TODO: Fill out this long description.

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [API](#api)
- [Maintainers](#maintainers)
- [Contributing](#contributing)
- [License](#license)

## Background

TODO

## Install

```sh
npm install rpc-reflector
```

## Usage

```js
const { createClient, createServer } = require('rpc-reflector')
const DuplexPair = require('native-duplexpair')

const myApi = {
  syncMethod: () => 'result1',
  asyncMethod: () =>
    new Promise((resolve, reject) => {
      setTimeout(() => resolve('result2'), 200)
    }),
}

// Create two duplex sockets linked together
const { socket1, socket2 } = new DuplexPair({ objectMode: true })

const serverStream = socket1
const clientStream = socket2

const { close } = createServer(myApi, serverStream)
const myApiOnClient = createClient(clientStream)(async () => {
  const result1 = await myApiOnClient.syncMethod()
  const result2 = await myApiOnClient.asyncMethod()
  console.log(result1) // 'result1'
  console.log(result2) // 'result2'
})()
```

## API

## Maintainers

[@digidem](https://github.com/digidem)

## Contributing

PRs accepted.

Small note: If editing the README, please conform to the [standard-readme](https://github.com/RichardLitt/standard-readme) specification.

## License

MIT © 2020 Gregor MacLennan
