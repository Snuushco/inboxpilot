const imap = require('../../lib/imap-engine');
const { sendJson, handleCors } = require('../../lib/response');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  return sendJson(res, 200, { ok: true, ...imap.getEngineMetrics() });
};
