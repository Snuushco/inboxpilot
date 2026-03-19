/**
 * InboxPilot Workspace Builder
 * Generates the workspace data structure for the app UI
 */
const { generateDemo, PLAN_CONFIG } = require('./demo-engine');
const helpers = require('./helpers');

function quickstartSteps(lead, demo) {
  const company = lead?.company || 'je team';
  const tone = lead?.tone || 'professioneel warm';
  const actions = (lead?.actions || '').toLowerCase();
  return [
    {
      title: 'Verbind eerste mailbox',
      detail: `${PLAN_CONFIG[demo.plan.key]?.mailboxLabel || 'Mailbox'} wordt als eerste omgeving geactiveerd voor ${company}.`,
      status: 'ready'
    },
    {
      title: 'Controleer prioriteitsregels',
      detail: `Hoge urgentie, klantimpact en omzetgevoelige mails komen nu automatisch bovenaan. Tone of voice staat op ${tone}.`,
      status: 'ready'
    },
    {
      title: 'Verzend eerste conceptreply',
      detail: demo.messages[0] ? `Bovenste item staat klaar met voorgestelde reply voor ${demo.messages[0].company}.` : 'Eerste conceptreply verschijnt zodra er een bericht binnenkomt.',
      status: 'ready'
    },
    {
      title: 'Activeer follow-up ritme',
      detail: actions.includes('reminder') || actions.includes('follow') ? 'Follow-up reminders zijn voorgeselecteerd op basis van je aanvraag.' : 'Standaard follow-up logica staat klaar en is later per mailbox te verfijnen.',
      status: 'ready'
    }
  ];
}

function buildWorkspace(lead) {
  const safeLead = lead || helpers.getLatestLead() || {
    leadId: 'demo-lead',
    firstName: 'Demo',
    lastName: 'User',
    company: 'InboxPilot Demo',
    email: 'demo@example.com',
    tone: 'professioneel warm',
    plan: 'Team',
    planKey: 'team',
    checkout: helpers.CHECKOUT_LINKS.team,
    mailboxes: '3-10',
    userType: 'mkb',
    actions: 'prioriteren, samenvatten, conceptantwoorden, reminders',
    mailTypes: 'klantvragen, offertes, support',
    submittedAt: new Date().toISOString()
  };

  const planKey = PLAN_CONFIG[safeLead.planKey] ? safeLead.planKey : helpers.normalizePlan(safeLead.plan || '') || 'team';
  const demo = generateDemo(planKey);
  const p2 = demo.messages.filter(item => item.triage.bucket.startsWith('P2'));
  const followUps = demo.messages.filter(item => item.followUpAt).slice(0, 5).map(item => ({
    id: `fu-${item.id}`,
    company: item.company,
    subject: item.subject,
    owner: item.recommendedOwner,
    dueAt: item.followUpAt,
    reason: item.deadlineText,
    status: item.triage.overdue ? 'escalate' : 'scheduled'
  }));

  const summaries = demo.messages.slice(0, 4).map(item => ({
    id: item.id,
    subject: item.subject,
    company: item.company,
    bucket: item.triage.bucket,
    summary: item.summary,
    why: item.triage.why
  }));

  const drafts = demo.messages.slice(0, 4).map(item => ({
    id: item.id,
    subject: item.subject,
    company: item.company,
    owner: item.recommendedOwner,
    draft: item.replyDraft,
    tone: item.toneHint
  }));

  const priorityQueue = demo.messages.map((item, index) => ({
    rank: index + 1,
    id: item.id,
    subject: item.subject,
    company: item.company,
    mailbox: item.mailbox,
    bucket: item.triage.bucket,
    score: item.triage.score,
    overdue: item.triage.overdue,
    owner: item.recommendedOwner,
    deadlineText: item.deadlineText,
    preview: item.preview,
    actions: item.actions,
    summary: item.summary
  }));

  const top = priorityQueue[0] || null;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    imapStatus: {
      configured: false,
      status: 'disconnected',
      realEmailCount: 0,
      messageCount: 0,
      note: 'IMAP polling requires persistent server. Connect your mailbox after setup.'
    },
    lead: {
      leadId: safeLead.leadId,
      canonicalLeadId: safeLead.duplicateOf || safeLead.canonicalLeadId || safeLead.leadId,
      firstName: safeLead.firstName,
      lastName: safeLead.lastName,
      company: safeLead.company,
      emailMasked: helpers.maskEmail(safeLead.email),
      userType: safeLead.userType,
      mailboxes: safeLead.mailboxes,
      mailTypes: safeLead.mailTypes,
      actions: safeLead.actions,
      tone: safeLead.tone,
      submittedAt: safeLead.submittedAt,
      duplicate: Boolean(safeLead.duplicate)
    },
    plan: {
      key: planKey,
      label: PLAN_CONFIG[planKey].label,
      mailboxLabel: PLAN_CONFIG[planKey].mailboxLabel,
      promise: PLAN_CONFIG[planKey].promise,
      checkout: safeLead.checkout || helpers.CHECKOUT_LINKS[planKey] || null
    },
    banner: {
      title: `Welkom in InboxPilot, ${safeLead.firstName || 'team'}`,
      subtitle: `Je ${PLAN_CONFIG[planKey].label}-workspace staat klaar voor ${safeLead.company || 'je organisatie'}. Prioriteiten, samenvattingen, conceptantwoorden en follow-ups zijn direct seeded voor demo en eerste live setup.`
    },
    metrics: [
      { label: 'Inbox items', value: demo.stats.inboxItems, hint: 'Seeded demo-inbox klaar' },
      { label: 'Direct oppakken', value: demo.stats.p1, hint: 'P1-berichten' },
      { label: 'Vandaag afronden', value: p2.length, hint: 'P2-berichten' },
      { label: 'Tijd bespaard', value: `${demo.stats.avgFirstPassSavedMinutes} min`, hint: 'Per eerste pass' },
      { label: 'Omzet in zicht', value: `€${Number(demo.stats.revenueAtRisk || 0).toLocaleString('nl-NL')}`, hint: 'Waarde in de inbox' }
    ],
    quickstart: quickstartSteps(safeLead, demo),
    spotlight: top ? {
      subject: top.subject,
      company: top.company,
      deadlineText: top.deadlineText,
      owner: top.owner,
      summary: top.summary,
      firstActions: top.actions.slice(0, 3)
    } : null,
    operatorDigest: demo.operatorDigest,
    priorityQueue,
    summaries,
    drafts,
    followUps
  };
}

module.exports = { buildWorkspace };
