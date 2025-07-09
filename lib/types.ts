import type { ErrorObject } from 'serialize-error'
import type { EventEmitter } from 'events'
import type { Readable } from 'stream'

import type { msgType } from './constants.js'

export interface test {
  foo: boolean
}

export type NonEmptyArray<T> = [T, ...T[]]

export type MsgId = number
type Prop = string
type EventName = string
type Args = Array<any>
type Params = Array<any>
type Result = any
type More = boolean
type IsObjectMode = boolean

export type MsgRequest = [
  typeof msgType.REQUEST,
  MsgId,
  NonEmptyArray<Prop>,
  Args,
]
// The last message in a streaming request
type MsgResponseEnd = [
  typeof msgType.RESPONSE,
  MsgId,
  ErrorObject | null,
  Result,
  false, // More data to come?
  IsObjectMode, // Last message in streaming response indicates if was objectMode
]
export type MsgResponse =
  | [
      typeof msgType.RESPONSE,
      MsgId, // messageId
      ErrorObject | null, // error
      Result?, // result
      More?, // more data to come?
    ]
  | MsgResponseEnd
export type MsgOn = [typeof msgType.ON, EventName, Array<Prop>]
export type MsgOff = [typeof msgType.OFF, EventName, Array<Prop>]
export type MsgEmit = [
  typeof msgType.EMIT,
  EventName,
  Array<Prop>,
  ErrorObject | null,
  Params?,
]
export type Message = MsgRequest | MsgResponse | MsgOn | MsgOff | MsgEmit

export type SubClient = ((...args: any[]) => Promise<any>) & Client

interface AnyMethod {
  [method: string]: SubClient
}

export type Client = AnyMethod & EventEmitter

export interface MessagePortLike {
  on(event: 'message', listener: (value: any) => void): this
  off(event: 'message', listener: (value: any) => void): this
  postMessage(value: any): void
}

// Turn a sync function into an async function, or stream to return the collated stream
type Asyncify<T extends (...args: any[]) => any> =
  ReturnType<T> extends Promise<infer Value>
    ? T
    : ReturnType<T> extends Readable
      ? // TODO: Is there a way to type streams that we can use here?
        (
          ...args: Parameters<T>
        ) => Promise<string | Buffer | Uint8Array | any[]>
      : (...args: Parameters<T>) => Promise<ReturnType<T>>

type Filter<KeyType, ExcludeType> = KeyType extends ExcludeType
  ? never
  : KeyType

// These EventEmitter methods are unavailable in EventEmitter3, which is what is used on the client
type UnavailableEmitterMethods =
  | 'setMaxListeners'
  | 'getMaxListeners'
  | 'prependListener'
  | 'prependOnceListener'

export type ClientApi<ServerApi extends {}> = {
  [KeyType in keyof ServerApi as Filter<
    KeyType,
    Symbol | UnavailableEmitterMethods
  >]: KeyType extends keyof EventEmitter
    ? ServerApi[KeyType]
    : ServerApi[KeyType] extends (...args: any[]) => any
      ? Asyncify<ServerApi[KeyType]>
      : ServerApi[KeyType] extends Array<infer T>
        ? () => Promise<T[]>
        : ServerApi[KeyType] extends { [key: string]: any }
          ? ClientApi<ServerApi[KeyType]> & (() => Promise<ServerApi[KeyType]>)
          : ServerApi[KeyType] extends Symbol
            ? never
            : () => Promise<ServerApi[KeyType]>
}
