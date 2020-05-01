import { ErrorObject } from 'serialize-error'
import { EventEmitter } from 'events'

export enum msgType {
  REQUEST = 0,
  RESPONSE,
  ON,
  OFF,
  EMIT,
}

export interface test {
  foo: boolean
}

type msgId = number
type propertyKey = string
type eventName = string
type args = ArrayLike<any>
type params = Array<any>
type result = any
type more = boolean
type isLast = true

export type MethodChain = Array<[propertyKey, args?]>
export type MsgRequest = [typeof msgType.REQUEST, msgId, MethodChain]
// The last message in a streaming request
type MsgResponseEnd = [
  typeof msgType.RESPONSE,
  msgId,
  ErrorObject | null,
  result,
  false, // More data to come?
  isLast // Last message in streaming response indicates if was objectMode
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
export type MsgOn = [typeof msgType.ON, eventName, MethodChain]
export type MsgOff = [typeof msgType.OFF, eventName, MethodChain]
export type MsgEmit = [
  typeof msgType.EMIT,
  eventName,
  MethodChain,
  ErrorObject | null,
  params?
]
export type Message = MsgRequest | MsgResponse | MsgOn | MsgOff | MsgEmit

export interface ProxyPromise<T> extends Promise<T> {
  /**
   * Attaches callbacks for the resolution and/or rejection of the Promise.
   * @param onfulfilled The callback to execute when the Promise is resolved.
   * @param onrejected The callback to execute when the Promise is rejected.
   * @returns A Promise for the completion of which ever callback is executed.
   */
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null
  ): ProxyPromise<TResult1 | TResult2> & Client

  /**
   * Attaches a callback for only the rejection of the Promise.
   * @param onrejected The callback to execute when the Promise is rejected.
   * @returns A Promise for the completion of the callback.
   */
  catch<TResult = never>(
    onrejected?:
      | ((reason: any) => TResult | PromiseLike<TResult>)
      | undefined
      | null
  ): ProxyPromise<T | TResult> & Client
}

export type SubClient = ((...args: any[]) => ProxyPromise<any> & Client) &
  Client

interface AnyMethod {
  [method: string]: SubClient
}

export type Client = AnyMethod & EventEmitter
