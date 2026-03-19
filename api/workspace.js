const store = require('../lib/store');
const { generateDemo, PLAN_CONFIG } = require('../lib/demo-engine');
const billing = require('../lib/billing');
const imap = require('../lib/imap-engine');
const { sendJson, handleCors } = require('../lib/response');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  store.initStore();

  const leadId = req.query.leadId || req.query.lead;
  const lead = store.findLeadById(leadId) || store.getLatestLead();

  const safeLead = lead || {
    leadId: 'demo-lead', firstName: 'Demo', lastName: 'User',
    company: 'InboxPilot Demo', email: 'demo@example.com',
    tone: 'professioneel warm', plan: 'Team', planKey: 'team',
    checkout: store.CHECKOUT_LINKS.team, mailboxes: '3-10', userType: 'mkb',
    actions: 'prioriteren, samenvatten, conceptantwoorden, reminders',
    mailTypes: 'klantvragen, offertes, support', submittedAt: new Date().toISOString()
  };

  const planKey = PLAN_CONFIG[safeLead.planKey] ? safeLead.planKey : store.normalizePlan(safeLead.plan || '') || 'team';
  const demo = generateDemo(planKey);
  const p2 = demo.messages.filter(item => item.triage.bucket.startsWith('P2'));

  const hasImap = imap.hasCredentials(safeLead.leadId);
  const realEmails = hasImap ? imap.getStoredMessages(safeLead.leadId, 30) : [];

  const priorityQueue = demo.messages.map((item, index) => ({
    rank: index + 1, id: item.id, subject: item.subject, company: item.company,
    mailbox: item.mailbox, bucket: item.triage.bucket, score: item.triage.score,
    overdue: item.triage.overdue, owner: item.recommendedOwner, deadlineText: item.deadlineText,
    preview: item.preview, actions: item.actions, summary: item.summary, isReal: false
  }));

  const realItems = realEmails.map((email, idx) => {
    const isUrgent = /urgent|dringend|asap|spoed/i.test(email.subject || '');
    const bucket = isUrgent ? 'P1 — Direct handelen' : 'P3 — Op schema';
    return {
      rank: idx + 1, id: `real-${email.uid}`, subject: email.subject,
      company: email.fromName || email.from, mailbox: 'INBOX', bucket,
      score: isUrgent ? 95 - idx : 50 - idx, overdue: false,
      owner: safeLead.firstName || 'Team', deadlineText: new Date(email.date).toLocaleDateString('nl-NL'),
      preview: (email.textBody || '').slice(0, 200), actions: ['Lezen', 'Beantwoorden'],
      summary: (email.textBody || '').slice(0, 300), isReal: true
    };
  });

  const mergedQueue = realItems.length > 0 ? [...realItems, ...priorityQueue] : priorityQueue;

  const effectiveLeadId = safeLead.leadId || safeLead.canonicalLeadId;
  const accessInfo = effectiveLeadId ? billing.getAccessLevel(effectiveLeadId) : { access: 'preview', status: 'no_subscription' };

  const workspace = {
    ok: true,
    generatedAt: new Date().toISOString(),
    imapStatus: { configured: hasImap, status: hasImap ? 'connected' : 'disconnected', realEmailCount: realEmails.length, messageCount: imap.getMessageCount(safeLead.leadId) },
    lead: {
      leadId: safeLead.leadId, canonicalLeadId: safeLead.duplicateOf || safeLead.canonicalLeadId || safeLead.leadId,
      firstName: safeLead.firstName, lastName: safeLead.lastName, company: safeLead.company,
      emailMasked: store.maskEmail(safeLead.email), userType: safeLead.userType,
      mailboxes: safeLead.mailboxes, mailTypes: safeLead.mailTypes, actions: safeLead.actions,
      tone: safeLead.tone, submittedAt: safeLead.submittedAt, duplicate: Boolean(safeLead.duplicate)
    },
    plan: { key: planKey, label: PLAN_CONFIG[planKey].label, mailboxLabel: PLAN_CONFIG[planKey].mailboxLabel, promise: PLAN_CONFIG[planKey].promise, checkout: safeLead.checkout || store.CHECKOUT_LINKS[planKey] || null },
    banner: { title: `Welkom in InboxPilot, ${safeLead.firstName || 'team'}`, subtitle: `Je ${PLAN_CONFIG[planKey].label}-workspace staat klaar voor ${safeLead.company || 'je organisatie'}.` },
    billing: { access: accessInfo.access, status: accessInfo.status, message: accessInfo.message || null, gracePeriodEnd: accessInfo.gracePeriodEnd || null },
    metrics: [
      { label: 'Inbox items', value: demo.stats.inboxItems, hint: 'Seeded demo-inbox' },
      { label: 'Direct oppakken', value: demo.stats.p1, hint: 'P1-berichten' },
      { label: 'Vandaag afronden', value: p2.length, hint: 'P2-berichten' },
      { label: 'Tijd bespaard', value: `${demo.stats.avgFirstPassSavedMinutes} min`, hint: 'Per eerste pass' },
      { label: 'Omzet in zicht', value: `€${Number(demo.stats.revenueAtRisk || 0).toLocaleString('nl-NL')}`, hint: 'Waarde in inbox' }
    ],
    quickstart: [
      { title: 'Verbind eerste mailbox', detail: 'Mailbox wordt als eerste geactiveerd.', status: 'ready' },
      { title: 'Controleer prioriteitsregels', detail: 'Hoge urgentie mails automatisch bovenaan.', status: 'ready' },
      { title: 'Verzend eerste conceptreply', detail: 'Conceptreply staat klaar.', status: 'ready' },
      { title: 'Activeer follow-up ritme', detail: 'Follow-up logica klaar.', status: 'ready' }
    ],
    operatorDigest: demo.operatorDigest,
    priorityQueue: mergedQueue,
    summaries: demo.messages.slice(0, 4).map(item => ({ id: item.id, subject: item.subject, company: item.company, bucket: item.triage.bucket, summary: item.summary, why: item.triage.why })),
    drafts: demo.messages.slice(0, 4).map(item => ({ id: item.id, subject: item.subject, company: item.company, owner: item.recommendedOwner, draft: item.replyDraft, tone: item.toneHint })),
    followUps: demo.messages.filter(item => item.followUpAt).slice(0, 5).map(item => ({ id: `fu-${item.id}`, company: item.company, subject: item.subject, owner: item.recommendedOwner, dueAt: item.followUpAt, reason: item.deadlineText, status: item.triage.overdue ? 'escalate' : 'scheduled' })),
    spotlight: demo.messages[0] ? { subject: demo.messages[0].subject, company: demo.messages[0].company, deadlineText: demo.messages[0].deadlineText, owner: demo.messages[0].recommendedOwner, summary: demo.messages[0].summary, firstActions: demo.messages[0].actions.slice(0, 3) } : null
  };

  return sendJson(res, 200, workspace);
};
