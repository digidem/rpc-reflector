import { ErrorObject } from 'serialize-error'

export enum msgType {
  REQUEST = 0,
  RESPONSE,
  ON,
  OFF,
  EMIT
}

export type JSONValue = JSONPrimitive | JSONObject | JSONArray
type JSONPrimitive = string | number | boolean | null
type JSONObject = { [member: string]: JSONValue }
export interface JSONArray extends Array<JSONValue> {}

export type MsgRequest = [typeof msgType.REQUEST, number, string, JSONArray?]
export type MsgResponse = [
  typeof msgType.RESPONSE,
  number,
  ErrorObject | null,
  JSONValue?
]
export type MsgOn = [typeof msgType.ON, string]
export type MsgOff = [typeof msgType.OFF, string]
export type MsgEmit = [
  typeof msgType.EMIT,
  string,
  ErrorObject | null,
  JSONArray?
]
export type Message = MsgRequest | MsgResponse | MsgOn | MsgOff | MsgEmit
