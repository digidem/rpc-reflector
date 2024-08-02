import type { ErrorObject } from 'serialize-error'
import type { EventEmitter } from 'events'
import type { Readable } from 'stream'

export enum msgType {
  REQUEST = 0,
  RESPONSE = 1,
  ON = 2,
  OFF = 3,
  EMIT = 4,
}

export interface test {
  foo: boolean
}

export type NonEmptyArray<T> = [T, ...T[]]

type msgId = number
type prop = string
type eventName = string
// a function arguments is not an array, but "array-like" e.g. it does not
// support array methods
type args = ArrayLike<any>
type params = Array<any>
type result = any
type more = boolean
type isObjectMode = boolean

export type MsgRequest = [
  typeof msgType.REQUEST,
  msgId,
  NonEmptyArray<prop>,
  args
]
// The last message in a streaming request
type MsgResponseEnd = [
  typeof msgType.RESPONSE,
  msgId,
  ErrorObject | null,
  result,
  false, // More data to come?
  isObjectMode // Last message in streaming response indicates if was objectMode
]
export type MsgResponse =
  | [
      typeof msgType.RESPONSE,
      msgId, // messageId
      ErrorObject | null, // error
      result?, // result
      more? // more data to come?
    ]
  | MsgResponseEnd
export type MsgOn = [typeof msgType.ON, eventName, Array<prop>]
export type MsgOff = [typeof msgType.OFF, eventName, Array<prop>]
export type MsgEmit = [
  typeof msgType.EMIT,
  eventName,
  Array<prop>,
  ErrorObject | null,
  params?
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
      (...args: Parameters<T>) => Promise<string | Buffer | Uint8Array | any[]>
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
