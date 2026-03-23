const { handleCors, normalizeText } = require('../../lib/helpers');
const crypto = require('crypto');

const confirmations = {
  approve_draft: { title: 'Concept goedgekeurd', detail: 'De reply staat klaar voor verzending.', icon: '✅', nextStep: 'Reply verschijnt in je outbox zodra de mailbox-koppeling actief is.' },
  snooze: { title: 'Bericht gesnooze', detail: 'Dit bericht komt over 2 uur terug in je priority queue.', icon: '⏰', nextStep: 'SortBox herinnert je automatisch.' },
  archive: { title: 'Gearchiveerd', detail: 'Dit bericht is uit je actieve queue gehaald.', icon: '📁', nextStep: 'Je kunt het altijd terugvinden via het archief.' },
  assign: { title: 'Toegewezen', detail: 'Dit bericht is gerouteerd naar de aanbevolen owner.', icon: '👤', nextStep: 'De owner ontvangt een notificatie.' },
  escalate: { title: 'Geëscaleerd', detail: 'Dit bericht krijgt prioriteit bij management.', icon: '🚨', nextStep: 'Escalatie-notificatie wordt verstuurd.' },
  mark_done: { title: 'Afgerond', detail: 'Dit bericht is gemarkeerd als afgehandeld.', icon: '✔️', nextStep: 'Het telt mee in je productiviteitsmetrics.' },
  dismiss: { title: 'Genegeerd', detail: 'Dit bericht is gefilterd als niet-relevant.', icon: '🗑️', nextStep: 'SortBox leert van deze keuze.' }
};

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const { messageId, action, leadId, note } = req.body || {};
  if (!messageId || !action) return res.status(400).json({ ok: false, error: 'missing_messageId_or_action' });

  const validActions = Object.keys(confirmations);
  if (!validActions.includes(action)) return res.status(400).json({ ok: false, error: 'invalid_action', validActions });

  const triageEvent = {
    id: `ta_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    messageId, action,
    leadId: leadId || null,
    note: normalizeText(note, 500) || null,
    performedAt: new Date().toISOString(),
    source: 'app_ui'
  };

  res.status(200).json({
    ok: true,
    triageEventId: triageEvent.id,
    action, messageId,
    confirmation: confirmations[action],
    performedAt: triageEvent.performedAt
  });
};
