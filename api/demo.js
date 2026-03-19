const { generateDemo } = require('../lib/demo-engine');
const { sendJson, handleCors } = require('../lib/response');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  const plan = req.query.plan || 'team';
  return sendJson(res, 200, { ok: true, demo: generateDemo(plan) });
};
