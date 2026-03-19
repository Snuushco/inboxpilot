const drip = require('../../lib/drip-engine');
const { sendJson, handleCors } = require('../../lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  try {
    const result = await drip.processDripQueue();
    return sendJson(res, 200, { ok: true, result });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message });
  }
};
