declare module 'abstract-logging' {
  type LogFunction = (...args: any[]) => void
  interface AbstractLogger {
    trace: LogFunction
    debug: LogFunction
    info: LogFunction
    warn: LogFunction
    error: LogFunction
    fatal: LogFunction
  }
  const nullLogger: AbstractLogger
  export default nullLogger
}
