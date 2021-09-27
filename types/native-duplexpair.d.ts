declare module 'native-duplexpair' {
  import { Duplex, DuplexOptions } from 'stream'
  class DuplexPair {
    constructor(opts?: DuplexOptions)
    readonly socket1: Duplex
    readonly socket2: Duplex
  }
  export = DuplexPair
}
