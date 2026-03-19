const imap = require('../../lib/imap-engine');
const { sendJson, handleCors } = require('../../lib/response');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  try {
    const { leadId, host, port, email, password } = req.body || {};
    if (!leadId || !host || !port || !email || !password) {
      return sendJson(res, 400, { ok: false, error: 'Vul alle velden in: leadId, host, port, email, password' });
    }
    const stored = imap.saveCredentials(leadId, { host, port: Number(port), email, password });
    return sendJson(res, 200, {
      ok: true, leadId, email, host, port: Number(port), connectedAt: stored.connectedAt,
      note: 'Serverless mode: IMAP polling is on-demand via /api/imap/poll. Credentials are encrypted in ephemeral /tmp storage.'
    });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message });
  }
};
