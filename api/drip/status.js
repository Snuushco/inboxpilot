const drip = require('../../lib/drip-engine');
const { sendJson, handleCors } = require('../../lib/response');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  const leadId = req.query.leadId;
  if (!leadId) return sendJson(res, 400, { ok: false, error: 'missing_leadId' });
  const status = drip.getDripStatus(leadId);
  if (!status) return sendJson(res, 404, { ok: false, error: 'no_drip_schedule_found' });
  return sendJson(res, 200, { ok: true, drip: status });
};
