const imap = require('../../lib/imap-engine');
const { sendJson, handleCors } = require('../../lib/response');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  const leadId = req.query.leadId;
  if (!leadId) return sendJson(res, 400, { ok: false, error: 'leadId parameter required' });
  const limit = Math.min(Number(req.query.limit || 50), 100);
  const messages = imap.getStoredMessages(leadId, limit);
  return sendJson(res, 200, {
    ok: true, leadId, count: messages.length,
    messages: messages.map(m => ({
      uid: m.uid, messageId: m.messageId, subject: m.subject, from: m.from,
      fromAddress: m.fromAddress, fromName: m.fromName, to: m.to, date: m.date,
      hasAttachments: m.hasAttachments, attachmentCount: m.attachmentCount,
      textBody: (m.textBody || '').slice(0, 500), fetchedAt: m.fetchedAt
    }))
  });
};
