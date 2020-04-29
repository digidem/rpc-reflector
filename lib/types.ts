import { ErrorObject } from 'serialize-error'
import { EventEmitter } from 'events'

export enum msgType {
  REQUEST = 0,
  RESPONSE,
  ON,
  OFF,
  EMIT,
}

export type MsgRequest = [typeof msgType.REQUEST, number, string, any[]]
export type MsgResponse = [
  typeof msgType.RESPONSE,
  number, // messageId
  ErrorObject | null, // error
  any?, // result
  boolean? // more data to come?
]
export type MsgOn = [typeof msgType.ON, string]
export type MsgOff = [typeof msgType.OFF, string]
export type MsgEmit = [typeof msgType.EMIT, string, ErrorObject | null, any[]?]
export type Message = MsgRequest | MsgResponse | MsgOn | MsgOff | MsgEmit

interface I {
  [method: string]: (...args: any[]) => Promise<any>
}

export type Client = I & EventEmitter
