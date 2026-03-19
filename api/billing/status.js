const billing = require('../../lib/billing');
const { sendJson, handleCors } = require('../../lib/response');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  const leadId = req.query.leadId;
  if (!leadId) return sendJson(res, 400, { ok: false, error: 'missing_leadId' });
  return sendJson(res, 200, { ok: true, ...billing.getAccessLevel(leadId) });
};
