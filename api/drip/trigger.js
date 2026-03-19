const drip = require('../../lib/drip-engine');
const store = require('../../lib/store');
const { sendJson, handleCors } = require('../../lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  const leadId = req.query.leadId || req.body?.leadId;
  const dayParam = req.query.day || req.body?.day;
  if (!leadId) return sendJson(res, 400, { ok: false, error: 'missing_leadId' });
  if (dayParam === undefined || dayParam === null) return sendJson(res, 400, { ok: false, error: 'missing_day' });
  const dayNum = parseInt(dayParam, 10);
  try {
    const existing = drip.getDripStatus(leadId);
    if (!existing) {
      const lead = store.findLeadById(leadId) || store.getLatestLead();
      if (!lead) return sendJson(res, 404, { ok: false, error: 'lead_not_found' });
      drip.initDripSchedule(lead);
    }
    const result = await drip.sendDripEmail(leadId, dayNum);
    return sendJson(res, 200, { ok: true, result });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message });
  }
};
