/**
 * @template {{}} ApiType
 * @typedef {import('./lib/types.js').ClientApi<ApiType>} ClientApi
 */
/** @typedef {import('./lib/types.js').MessagePortLike} MessagePortLike */
/** @typedef {import('./lib/types.js').MessageEvent} MessageEvent */

export { createClient } from './client.js'
export { createServer } from './server.js'
export { ChannelClosedError, TimeoutError } from './lib/errors.js'
