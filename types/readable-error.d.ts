declare module 'readable-error' {
  import { Readable } from 'stream'
  class ReadableError extends Readable {
    constructor(error: Error)
  }
  export = ReadableError
}
