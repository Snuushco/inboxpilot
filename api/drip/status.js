const { handleCors } = require('../../lib/helpers');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const leadId = req.query.leadId;
  if (!leadId) return res.status(400).json({ ok: false, error: 'missing_leadId' });
  // MVP stub — drip status
  res.status(200).json({ ok: true, drip: { leadId, status: 'scheduled', emails: [] } });
};
