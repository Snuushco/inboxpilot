const store = require('../lib/store');
const { sendJson, handleCors } = require('../lib/response');
const { generateDemo, PLAN_CONFIG } = require('../lib/demo-engine');
const billing = require('../lib/billing');
const imap = require('../lib/imap-engine');

function buildWorkspace(lead) {
  const safeLead = lead || store.getLatestLead() || {
    leadId: 'demo-lead', firstName: 'Demo', lastName: 'User',
    company: 'InboxPilot Demo', email: 'demo@example.com',
    tone: 'professioneel warm', plan: 'Team', planKey: 'team',
    checkout: store.CHECKOUT_LINKS.team, mailboxes: '3-10', userType: 'mkb',
    actions: 'prioriteren, samenvatten, conceptantwoorden, reminders',
    mailTypes: 'klantvragen, offertes, support', submittedAt: new Date().toISOString()
  };

  const planKey = PLAN_CONFIG[safeLead.planKey] ? safeLead.planKey : store.normalizePlan(safeLead.plan || '') || 'team';
  const demo = generateDemo(planKey);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    imapStatus: { configured: false, status: 'disconnected', realEmailCount: 0 },
    lead: {
      leadId: safeLead.leadId, firstName: safeLead.firstName, lastName: safeLead.lastName,
      company: safeLead.company, emailMasked: store.maskEmail(safeLead.email),
      submittedAt: safeLead.submittedAt
    },
    plan: { key: planKey, label: PLAN_CONFIG[planKey].label, mailboxLabel: PLAN_CONFIG[planKey].mailboxLabel, promise: PLAN_CONFIG[planKey].promise, checkout: safeLead.checkout || store.CHECKOUT_LINKS[planKey] || null },
    banner: { title: `Welkom in InboxPilot, ${safeLead.firstName || 'team'}`, subtitle: `Je ${PLAN_CONFIG[planKey].label}-workspace staat klaar voor ${safeLead.company || 'je organisatie'}.` },
    metrics: [
      { label: 'Inbox items', value: demo.stats.inboxItems, hint: 'Seeded demo-inbox' },
      { label: 'Direct oppakken', value: demo.stats.p1, hint: 'P1-berichten' },
      { label: 'Tijd bespaard', value: `${demo.stats.avgFirstPassSavedMinutes} min`, hint: 'Per eerste pass' },
      { label: 'Omzet in zicht', value: `€${Number(demo.stats.revenueAtRisk || 0).toLocaleString('nl-NL')}`, hint: 'Waarde in de inbox' }
    ],
    operatorDigest: demo.operatorDigest,
    priorityQueue: demo.messages.map((item, index) => ({
      rank: index + 1, id: item.id, subject: item.subject, company: item.company,
      mailbox: item.mailbox, bucket: item.triage.bucket, score: item.triage.score,
      overdue: item.triage.overdue, owner: item.recommendedOwner, deadlineText: item.deadlineText,
      preview: item.preview, actions: item.actions, summary: item.summary
    })),
    summaries: demo.messages.slice(0, 4).map(item => ({ id: item.id, subject: item.subject, company: item.company, bucket: item.triage.bucket, summary: item.summary, why: item.triage.why })),
    drafts: demo.messages.slice(0, 4).map(item => ({ id: item.id, subject: item.subject, company: item.company, owner: item.recommendedOwner, draft: item.replyDraft, tone: item.toneHint })),
    followUps: demo.messages.filter(item => item.followUpAt).slice(0, 5).map(item => ({ id: `fu-${item.id}`, company: item.company, subject: item.subject, owner: item.recommendedOwner, dueAt: item.followUpAt, reason: item.deadlineText, status: item.triage.overdue ? 'escalate' : 'scheduled' })),
    quickstart: [
      { title: 'Verbind eerste mailbox', detail: 'Wordt als eerste omgeving geactiveerd.', status: 'ready' },
      { title: 'Controleer prioriteitsregels', detail: 'Hoge urgentie mails komen automatisch bovenaan.', status: 'ready' },
      { title: 'Verzend eerste conceptreply', detail: 'Conceptreply staat klaar.', status: 'ready' },
      { title: 'Activeer follow-up ritme', detail: 'Follow-up logica staat klaar.', status: 'ready' }
    ],
    spotlight: demo.messages[0] ? { subject: demo.messages[0].subject, company: demo.messages[0].company, deadlineText: demo.messages[0].deadlineText, owner: demo.messages[0].recommendedOwner, summary: demo.messages[0].summary, firstActions: demo.messages[0].actions.slice(0, 3) } : null
  };
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) return sendJson(res, 415, { ok: false, error: 'content_type_must_be_json' });

  const input = req.body;
  if (!input) return sendJson(res, 400, { ok: false, error: 'missing_body' });

  store.initStore();
  const payload = store.buildLeadPayload(input);
  const validationError = store.validateLeadPayload(payload);
  if (validationError) return sendJson(res, 400, { ok: false, error: validationError });

  const writeResult = store.upsertLeadFiles(payload);

  // Try to send notification email
  let notifyResult = { mailed: false, reason: 'serverless' };
  try {
    const nodemailer = require('nodemailer');
    const user = process.env.STRATO_USER;
    const pass = process.env.STRATO_PASS;
    if (user && pass) {
      const transporter = nodemailer.createTransport({ host: 'smtp.strato.de', port: 465, secure: true, auth: { user, pass } });
      const info = await transporter.sendMail({
        from: 'Emily <emily@praesidion.com>', to: 'emily@praesidion.com',
        subject: `InboxPilot signup - ${payload.plan} - ${payload.firstName} ${payload.lastName}`,
        text: `Nieuwe signup:\nNaam: ${payload.firstName} ${payload.lastName}\nEmail: ${payload.email}\nBedrijf: ${payload.company}\nPlan: ${payload.plan}`
      });
      notifyResult = { mailed: true, messageId: info.messageId };
    }
  } catch (err) { notifyResult = { mailed: false, reason: err.message }; }

  // Try welcome email
  let welcomeResult = { sent: false, reason: 'not_attempted' };
  try {
    const drip = require('../lib/drip-engine');
    welcomeResult = await drip.sendWelcomeEmail(payload);
  } catch (err) { welcomeResult = { sent: false, reason: err.message }; }

  const workspace = buildWorkspace(payload);
  const canonicalLeadId = payload.duplicateOf || payload.leadId;

  return sendJson(res, 200, {
    ok: true, leadId: payload.leadId, canonicalLeadId,
    duplicate: payload.duplicate, checkout: payload.checkout,
    appUrl: `/app?leadId=${encodeURIComponent(canonicalLeadId)}`,
    mailed: notifyResult.mailed, welcomeEmail: welcomeResult, workspace
  });
};
