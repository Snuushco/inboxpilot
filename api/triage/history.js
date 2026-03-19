const store = require('../../lib/store');
const { sendJson, handleCors } = require('../../lib/response');
const path = require('path');
const fs = require('fs');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  const triageLogPath = path.join(store.TRIAGE_DIR, 'actions.jsonl');
  if (!fs.existsSync(triageLogPath)) return sendJson(res, 200, { ok: true, actions: [] });
  const lines = fs.readFileSync(triageLogPath, 'utf8').trim().split('\n').filter(Boolean);
  const actions = lines.map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  return sendJson(res, 200, { ok: true, count: actions.length, actions: actions.slice(-50).reverse() });
};
