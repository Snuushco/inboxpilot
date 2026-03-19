const { handleCors } = require('../lib/helpers');
const { generateDemo } = require('../lib/demo-engine');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  
  const plan = req.query.plan || 'team';
  res.status(200).json({ ok: true, demo: generateDemo(plan) });
};
