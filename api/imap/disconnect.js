const { handleCors } = require('../../lib/helpers');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  const leadId = req.query.leadId;
  if (!leadId) return res.status(400).json({ ok: false, error: 'leadId parameter required' });
  res.status(200).json({ ok: true, leadId, configured: false, note: 'IMAP requires persistent server' });
};
