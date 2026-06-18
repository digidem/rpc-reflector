/**
 * @template {{}} ApiType
 * @typedef {import('./lib/types.js').ClientApi<ApiType>} ClientApi
 */
/** @typedef {import('./lib/types.js').MessagePortLike} MessagePortLike */
/** @typedef {import('./lib/types.js').MessageEvent} MessageEvent */
/** @typedef {import('./client.js').OnRequestHook} ClientOnRequestHook */
/** @typedef {import('./server.js').OnRequestHook} ServerOnRequestHook */
/** @typedef {import('./lib/types.js').Logger} Logger */
/** @typedef {import('./client.js').ClientOptions} ClientOptions */
/** @typedef {import('./server.js').ServerOptions} ServerOptions */

export { createClient } from './client.js'
export { createServer } from './server.js'
export { ChannelClosedError, TimeoutError } from './lib/errors.js'
