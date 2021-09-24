import { ErrorObject } from 'serialize-error'
import { EventEmitter } from 'events'

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
