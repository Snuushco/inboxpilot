const imap = require('../../lib/imap-engine');
const { sendJson, handleCors } = require('../../lib/response');
const fs = require('fs');
const path = require('path');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  const leadId = req.query.leadId || req.body?.leadId;
  if (!leadId) return sendJson(res, 400, { ok: false, error: 'leadId parameter required' });
  if (!imap.hasCredentials(leadId)) return sendJson(res, 404, { ok: false, error: 'Geen IMAP configuratie gevonden voor deze lead' });

  // MVP serverless fallback: no live IMAP fetch in serverless; return stored messages only.
  // Known limitation documented for Vercel deployment.
  const messages = imap.getStoredMessages(leadId, 20);
  return sendJson(res, 200, {
    ok: true, leadId, fetched: 0, messages: messages.map(m => ({ uid: m.uid, subject: m.subject, from: m.from, date: m.date })),
    note: 'Serverless MVP limitation: polling is on-demand but this deployment currently returns stored /tmp messages only. Production solution: Vercel KV + background worker or external IMAP worker.'
  });
};
