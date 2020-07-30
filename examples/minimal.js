const { createClient, createServer } = require('..')
const DuplexPair = require('native-duplexpair')

const myApi = {
  syncMethod: () => 'result1',
  asyncMethod: () =>
    new Promise((resolve, reject) => {
      setTimeout(() => resolve('result2'), 200)
    }),
}

// Create two duplex sockets linked together
// @ts-ignore
const { socket1, socket2 } = new DuplexPair({ objectMode: true })

const serverStream = socket1
const clientStream = socket2

const { close } = createServer(myApi, serverStream)
const myApiOnClient = createClient(clientStream)

;(async () => {
  const result1 = await myApiOnClient.syncMethod()
  const result2 = await myApiOnClient.asyncMethod()
  console.log(result1) // 'result1'
  console.log(result2) // 'result2'
})()
