const { handleCors } = require('../../lib/helpers');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  // In serverless, triage history is ephemeral
  res.status(200).json({ ok: true, count: 0, actions: [] });
};
