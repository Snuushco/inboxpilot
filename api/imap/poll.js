const imap = require('../../lib/imap-engine');
const { sendJson, handleCors } = require('../../lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  const leadId = req.query.leadId || req.body?.leadId;
  if (!leadId) return sendJson(res, 400, { ok: false, error: 'leadId parameter required' });
  if (!imap.hasCredentials(leadId)) return sendJson(res, 404, { ok: false, error: 'Geen IMAP configuratie gevonden voor deze lead' });

  try {
    const maxMessages = Math.min(Number(req.query.max || req.body?.max || 20), 50);
    const result = await imap.fetchLiveMessages(leadId, { maxMessages });
    return sendJson(res, 200, {
      ok: true,
      leadId,
      totalInMailbox: result.totalInMailbox,
      fetched: result.fetched.length,
      newStored: result.newStored,
      messages: result.fetched.map(m => ({
        uid: m.uid, subject: m.subject, from: m.from, fromName: m.fromName, date: m.date
      }))
    });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message, code: err.code || 'IMAP_ERROR' });
  }
};
