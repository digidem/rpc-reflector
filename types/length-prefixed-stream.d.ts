// Type definitions for length-prefixed-stream 2.0.0
// Project: https://github.com/mafintosh/length-prefixed-stream

/// <reference types="node" />

declare module 'length-prefixed-stream' {
  export function encode(): NodeJS.ReadWriteStream
  export function decode(): NodeJS.ReadWriteStream
}
