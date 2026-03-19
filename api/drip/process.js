const { handleCors } = require('../../lib/helpers');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  res.status(200).json({ ok: true, result: { processed: 0, note: 'Drip processing runs via cron/background' } });
};
