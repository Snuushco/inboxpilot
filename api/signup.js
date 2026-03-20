const { handleCors, buildLeadPayload, validateLeadPayload, upsertLeadFiles, CHECKOUT_LINKS } = require('../lib/helpers');
const { buildWorkspace } = require('../lib/workspace');

async function sendWelcomeEmail(payload) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { sent: false, reason: 'no_resend_key' };

  const resendDomain = process.env.RESEND_FROM_DOMAIN || 'snelrie.nl';
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `InboxPilot <inboxpilot@${resendDomain}>`,
        reply_to: 'emily@praesidion.com',
        to: [payload.email],
        subject: `Welkom bij InboxPilot, ${payload.firstName}! Je workspace staat klaar.`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <h1 style="color:#1e293b;">Welkom bij InboxPilot 🚀</h1>
          <p>Hi ${payload.firstName},</p>
          <p>Je <strong>${payload.planKey?.toUpperCase() || 'Team'}</strong>-workspace voor <strong>${payload.company || 'je organisatie'}</strong> staat klaar.</p>
          <p>Wat InboxPilot direct voor je doet:</p>
          <ul>
            <li>📬 Inbox prioritering — urgente mails bovenaan</li>
            <li>📝 Automatische samenvattingen — scan in seconden</li>
            <li>✉️ Concept-antwoorden — review en verstuur in 1 klik</li>
            <li>⏰ Follow-up tracking — niets valt meer tussen wal en schip</li>
          </ul>
          <p><a href="https://inboxpilot-six.vercel.app/app?leadId=${encodeURIComponent(payload.leadId)}" style="display:inline-block;background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Open je workspace →</a></p>
          <p style="color:#64748b;font-size:14px;margin-top:24px;">Je eerste maand is gratis. Geen creditcard nodig om te starten.</p>
          <p style="color:#64748b;font-size:14px;">Vragen? Reply op deze email — Emily (ik!) help je persoonlijk.</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="color:#94a3b8;font-size:12px;">InboxPilot by Praesidion • <a href="https://praesidion.com">praesidion.com</a></p>
        </div>`
      })
    });
    const result = await resp.json();
    return { sent: resp.ok, messageId: result.id || null, error: result.message || null };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

async function notifyTeam(payload) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { mailed: false, reason: 'no_resend_key' };
  const resendDomain = process.env.RESEND_FROM_DOMAIN || 'snelrie.nl';

  try {
    const lines = [
      'Nieuwe InboxPilot signup',
      '',
      `Naam: ${payload.firstName} ${payload.lastName}`,
      `Email: ${payload.email}`,
      `Bedrijf: ${payload.company || '(geen)'}`,
      `Plan: ${payload.plan} (${payload.planKey})`,
      `Checkout: ${payload.checkout || '(enterprise)'}`,
      `LeadId: ${payload.leadId}`,
      `Duplicate: ${payload.duplicate ? 'yes' : 'no'}`
    ].join('\n');

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `InboxPilot Alerts <inboxpilot@${resendDomain}>`,
        to: ['emily@praesidion.com'],
        subject: `[InboxPilot] Signup: ${payload.plan} — ${payload.firstName} ${payload.lastName}`,
        text: lines
      })
    });
    const result = await resp.json();
    return { mailed: resp.ok, messageId: result.id || null };
  } catch (err) {
    return { mailed: false, reason: err.message };
  }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return res.status(415).json({ ok: false, error: 'content_type_must_be_json' });
  }

  const input = req.body;
  if (!input) return res.status(400).json({ ok: false, error: 'empty_body' });

  const payload = buildLeadPayload(input);
  const validationError = validateLeadPayload(payload);
  if (validationError) return res.status(400).json({ ok: false, error: validationError });

  const writeResult = upsertLeadFiles(payload);
  
  // Send emails in parallel
  const [notifyResult, welcomeResult] = await Promise.all([
    notifyTeam(payload).catch(e => ({ mailed: false, reason: e.message })),
    sendWelcomeEmail(payload).catch(e => ({ sent: false, reason: e.message }))
  ]);

  const workspace = buildWorkspace(payload);
  const canonicalLeadId = payload.duplicateOf || payload.leadId;

  res.status(200).json({
    ok: true,
    leadId: payload.leadId,
    canonicalLeadId,
    duplicate: payload.duplicate,
    checkout: payload.checkout,
    appUrl: `/app?leadId=${encodeURIComponent(canonicalLeadId)}`,
    mailed: notifyResult.mailed,
    mailMessageId: notifyResult.messageId || null,
    welcomeEmail: welcomeResult,
    workspace
  });
};
