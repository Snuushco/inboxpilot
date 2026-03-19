const imap = require('../../lib/imap-engine');
const { sendJson, handleCors } = require('../../lib/response');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  const leadId = req.query.leadId;
  if (!leadId) return sendJson(res, 400, { ok: false, error: 'leadId parameter required' });
  const cred = imap.loadCredentials(leadId);
  const pollStatus = imap.getPollingStatus(leadId);
  const messageCount = imap.getMessageCount(leadId);
  return sendJson(res, 200, {
    ok: true, leadId, configured: !!cred,
    email: cred ? cred.email : null, host: cred ? cred.host : null, port: cred ? cred.port : null,
    connectedAt: cred ? cred.connectedAt : null, polling: pollStatus, messageCount
  });
};
