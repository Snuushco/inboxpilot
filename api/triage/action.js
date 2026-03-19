const store = require('../../lib/store');
const { sendJson, handleCors } = require('../../lib/response');
const crypto = require('crypto');
const path = require('path');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  const { messageId, action, leadId, note } = req.body || {};
  if (!messageId || !action) return sendJson(res, 400, { ok: false, error: 'missing_messageId_or_action' });
  const validActions = ['approve_draft', 'snooze', 'archive', 'assign', 'escalate', 'mark_done', 'dismiss'];
  if (!validActions.includes(action)) return sendJson(res, 400, { ok: false, error: 'invalid_action', validActions });

  store.initStore();
  const triageLogPath = path.join(store.TRIAGE_DIR, 'actions.jsonl');
  const triageEvent = {
    id: `ta_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    messageId, action, leadId: leadId || null, note: store.normalizeText(note, 500) || null,
    performedAt: new Date().toISOString(), source: 'app_ui'
  };
  store.appendJsonLine(triageLogPath, triageEvent);

  const confirmations = {
    approve_draft: { title: 'Concept goedgekeurd', detail: 'De reply staat klaar voor verzending.', icon: '✅', nextStep: 'Reply verschijnt in je outbox zodra de mailbox-koppeling actief is.' },
    snooze: { title: 'Bericht gesnooze', detail: 'Dit bericht komt over 2 uur terug in je priority queue.', icon: '⏰', nextStep: 'InboxPilot herinnert je automatisch.' },
    archive: { title: 'Gearchiveerd', detail: 'Dit bericht is uit je actieve queue gehaald.', icon: '📁', nextStep: 'Je kunt het altijd terugvinden via het archief.' },
    assign: { title: 'Toegewezen', detail: `Dit bericht is gerouteerd naar de aanbevolen owner${note ? ': ' + note : ''}.`, icon: '👤', nextStep: 'De owner ontvangt een notificatie met context.' },
    escalate: { title: 'Geëscaleerd', detail: 'Dit bericht is gemarkeerd als escalatie.', icon: '🚨', nextStep: 'Escalatie-notificatie wordt verstuurd naar de duty lead.' },
    mark_done: { title: 'Afgerond', detail: 'Dit bericht is gemarkeerd als afgehandeld.', icon: '✔️', nextStep: 'Het verdwijnt uit je actieve queue.' },
    dismiss: { title: 'Genegeerd', detail: 'Dit bericht is gefilterd als niet-relevant.', icon: '🗑️', nextStep: 'InboxPilot leert van deze keuze.' }
  };

  return sendJson(res, 200, { ok: true, triageEventId: triageEvent.id, action, messageId, confirmation: confirmations[action], performedAt: triageEvent.performedAt });
};
