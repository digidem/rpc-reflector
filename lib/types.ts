import { ErrorObject } from 'serialize-error'
import { EventEmitter } from 'events'

export enum msgType {
  REQUEST = 0,
  RESPONSE,
  ON,
  OFF,
  EMIT,
}

export type MsgRequest = [typeof msgType.REQUEST, number, string[], any[]]
// The last message in a streaming request
type MsgResponseEnd = [
  typeof msgType.RESPONSE,
  number,
  ErrorObject | null,
  any,
  false,
  boolean? // Last message in streaming response indicates if was objectMode
]
export type MsgResponse =
  | [
      typeof msgType.RESPONSE,
      number, // messageId
      ErrorObject | null, // error
      any?, // result
      boolean? // more data to come?
    ]
  | MsgResponseEnd
export type MsgOn = [typeof msgType.ON, string]
export type MsgOff = [typeof msgType.OFF, string]
export type MsgEmit = [typeof msgType.EMIT, string, ErrorObject | null, any[]?]
export type Message = MsgRequest | MsgResponse | MsgOn | MsgOff | MsgEmit

interface I {
  [method: string]: (...args: any[]) => Promise<any>
}

export type Client = (...args: any[]) => Promise<any> & I & EventEmitter
