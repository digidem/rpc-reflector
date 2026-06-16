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
  /** @type {import('../index.js').ClientApi<typeof myApi>} */ (
    createClient(clientPort)
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
