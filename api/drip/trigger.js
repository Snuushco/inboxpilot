const { handleCors } = require('../../lib/helpers');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const leadId = req.query.leadId;
  if (!leadId) return res.status(400).json({ ok: false, error: 'missing_leadId' });
  // MVP stub
  res.status(200).json({ ok: true, result: { triggered: true, leadId, note: 'Drip engine runs on background server' } });
};
