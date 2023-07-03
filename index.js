/**
 * @template {{}} ApiType
 * @typedef {import('./lib/types').ClientApi<ApiType>} ClientApi
 */

module.exports.createClient = require('./client')
module.exports.createServer = require('./server')
module.exports.createEncodeDecodeStream = require('./encode-decode')
