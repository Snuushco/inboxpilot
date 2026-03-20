const { handleCors } = require('../../lib/helpers');
const drip = require('../../lib/drip-engine');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  
  const leadId = req.query.leadId || req.body?.leadId;
  const dayParam = req.query.day || req.body?.day;
  
  if (!leadId) return res.status(400).json({ ok: false, error: 'missing_leadId' });
  if (dayParam === undefined || dayParam === null) return res.status(400).json({ ok: false, error: 'missing_day' });
  
  const dayNum = parseInt(dayParam, 10);
  
  try {
    const result = await drip.sendDripEmail(leadId, dayNum);
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
