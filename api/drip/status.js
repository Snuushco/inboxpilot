const { handleCors } = require('../../lib/helpers');
const drip = require('../../lib/drip-engine');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  
  const leadId = req.query.leadId;
  if (!leadId) return res.status(400).json({ ok: false, error: 'missing_leadId' });
  
  try {
    const status = drip.getDripStatus(leadId);
    if (!status) return res.status(404).json({ ok: false, error: 'no_drip_schedule_found' });
    return res.status(200).json({ ok: true, drip: status });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
