const PLAN_CONFIG = {
  solo: {
    label: 'Solo',
    mailboxLabel: '1 mailbox • ondernemer',
    promise: 'Rust in één drukke mailbox zonder extra adminkracht.'
  },
  pro: {
    label: 'Pro',
    mailboxLabel: '1-3 mailboxen • klein team',
    promise: 'Meer follow-up discipline, minder vergeten taken.'
  },
  team: {
    label: 'Team',
    mailboxLabel: '3-10 mailboxen • gedeelde inboxen',
    promise: 'Routing, prioritering en duidelijke taakverdeling voor klantverkeer.'
  },
  ops: {
    label: 'Ops',
    mailboxLabel: '10+ mailboxen • mailbox-zwaar bedrijf',
    promise: 'Operationele sturing met SLA, escalaties en approval-ready concepten.'
  },
  enterprise: {
    label: 'Enterprise',
    mailboxLabel: 'Custom governance',
    promise: 'Governance, audit trails en maatwerkflows over meerdere teams.'
  }
};

const BASE_MESSAGES = [
  {
    id: 'msg-lead-001',
    mailbox: 'sales@northline-logistics.nl',
    fromName: 'Marit Jansen',
    fromEmail: 'marit.jansen@northline-logistics.nl',
    company: 'Northline Logistics',
    subject: 'Offerteaanvraag nachtbeveiliging distributiecentrum Echt',
    preview: 'We willen volgende week een voorstel voor vaste nachtbewaking op onze locatie in Echt. Start mogelijk per 1 april.',
    receivedAt: '2026-03-19T07:42:00+01:00',
    category: 'sales_opportunity',
    urgency: 'high',
    customerImpact: 'high',
    revenuePotential: 18500,
    deadlineText: 'Voorstel gevraagd voor morgen 12:00',
    toneHint: 'professioneel warm',
    asks: [
      'stuur voorstel',
      'bevestig beschikbaarheid',
      'plan eventueel locatiecheck'
    ],
    entities: ['Echt', 'nachtbeveiliging', '1 april'],
    slaMinutes: 60,
    recommendedOwner: 'Sales',
    followUpWindowHours: 4
  },
  {
    id: 'msg-client-002',
    mailbox: 'operations@praesidion.com',
    fromName: 'Petra Smeets',
    fromEmail: 'petra.smeets@zorgcampuszuid.nl',
    company: 'Zorgcampus Zuid',
    subject: 'Spoed: portier gisteren niet verschenen bij avonddienst',
    preview: 'Wij hebben gisteren tussen 18:00 en 18:25 niemand bij de receptie gezien. Graag direct terugkoppeling en oplossing voor vanavond.',
    receivedAt: '2026-03-19T06:58:00+01:00',
    category: 'client_issue',
    urgency: 'critical',
    customerImpact: 'critical',
    revenuePotential: 0,
    deadlineText: 'Reactie binnen 15 minuten nodig',
    toneHint: 'kort zakelijk',
    asks: [
      'bevestig incidentonderzoek',
      'beloof terugkoppeling',
      'regel bezetting voor vanavond'
    ],
    entities: ['receptie', '18:00', '18:25', 'vanavond'],
    slaMinutes: 15,
    recommendedOwner: 'Operations',
    followUpWindowHours: 1
  },
  {
    id: 'msg-vendor-003',
    mailbox: 'finance@praesidion.com',
    fromName: 'Facturatie Rabobank Lease',
    fromEmail: 'noreply@rabolease.nl',
    company: 'Rabobank Lease',
    subject: 'Herinnering openstaande leasefactuur voertuig 24-019',
    preview: 'Volgens onze administratie staat factuur 24-019 nog open. Wij verzoeken u betaling binnen 5 werkdagen te voldoen.',
    receivedAt: '2026-03-18T23:17:00+01:00',
    category: 'finance',
    urgency: 'medium',
    customerImpact: 'medium',
    revenuePotential: 0,
    deadlineText: 'Betaaltermijn over 5 werkdagen',
    toneHint: 'direct',
    asks: [
      'controleer factuurstatus',
      'wijs toe aan finance'
    ],
    entities: ['factuur 24-019', '5 werkdagen'],
    slaMinutes: 1440,
    recommendedOwner: 'Finance',
    followUpWindowHours: 24
  },
  {
    id: 'msg-internal-004',
    mailbox: 'team@praesidion.com',
    fromName: 'Jimmy Verheijen',
    fromEmail: 'jimmy@praesidion.com',
    company: 'Praesidion',
    subject: 'Kan rooster vrijdag 22:00-06:00 nog aangepast worden?',
    preview: 'Ik heb vrijdag onverwacht opvangissues. Is er iemand die de nachtdienst in Maastricht kan overnemen?',
    receivedAt: '2026-03-19T08:04:00+01:00',
    category: 'internal_ops',
    urgency: 'medium',
    customerImpact: 'high',
    revenuePotential: 0,
    deadlineText: 'Vandaag voor 10:00 vervanging regelen',
    toneHint: 'vriendelijk',
    asks: [
      'check beschikbaarheid pool',
      'bevestig ontvangst',
      'maak taak voor planning'
    ],
    entities: ['vrijdag', '22:00-06:00', 'Maastricht'],
    slaMinutes: 90,
    recommendedOwner: 'Planning',
    followUpWindowHours: 2
  },
  {
    id: 'msg-noise-005',
    mailbox: 'info@praesidion.com',
    fromName: 'LinkedIn Jobs',
    fromEmail: 'jobs-listings@linkedin.com',
    company: 'LinkedIn',
    subject: '12 nieuwe kandidaten bekeken jouw vacature',
    preview: 'Bekijk statistieken, tips en promoted vacatures om je bereik te verhogen.',
    receivedAt: '2026-03-19T05:11:00+01:00',
    category: 'noise',
    urgency: 'low',
    customerImpact: 'low',
    revenuePotential: 0,
    deadlineText: 'Geen actie nodig',
    toneHint: 'kort zakelijk',
    asks: ['archiveer of bundel in digest'],
    entities: ['vacaturestatistieken'],
    slaMinutes: 10080,
    recommendedOwner: 'None',
    followUpWindowHours: 0
  },
  {
    id: 'msg-support-006',
    mailbox: 'support@praesidion.com',
    fromName: 'Dennis Kusters',
    fromEmail: 'dennis@bouwplekzuid.nl',
    company: 'Bouwplek Zuid',
    subject: 'Toegangsbadge subcontractor werkt niet op locatie Sittard',
    preview: 'Onze onderaannemer staat nu buiten en kan het terrein niet op. Kunnen jullie dit direct oplossen?',
    receivedAt: '2026-03-19T08:12:00+01:00',
    category: 'service_request',
    urgency: 'high',
    customerImpact: 'high',
    revenuePotential: 4200,
    deadlineText: 'Binnen 20 minuten oplossen of terugbellen',
    toneHint: 'professioneel warm',
    asks: [
      'check badge status',
      'bel locatiecontact',
      'bevestig ETA'
    ],
    entities: ['Sittard', 'onderaannemer', 'toegangsbadge'],
    slaMinutes: 20,
    recommendedOwner: 'Support',
    followUpWindowHours: 1
  }
];

function minutesSince(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime();
  return Math.max(0, Math.round(diffMs / 60000));
}

function urgencyWeight(value) {
  return {
    critical: 50,
    high: 35,
    medium: 18,
    low: 4
  }[value] || 0;
}

function impactWeight(value) {
  return {
    critical: 35,
    high: 22,
    medium: 12,
    low: 2
  }[value] || 0;
}

function revenueWeight(value) {
  if (!value) return 0;
  if (value >= 15000) return 20;
  if (value >= 5000) return 12;
  if (value >= 1000) return 6;
  return 2;
}

function planBonus(planKey, category) {
  if (planKey === 'solo' && category === 'noise') return -5;
  if (planKey === 'pro' && category === 'internal_ops') return 3;
  if (planKey === 'team' && ['client_issue', 'service_request', 'internal_ops'].includes(category)) return 7;
  if (planKey === 'ops' && ['client_issue', 'service_request', 'finance'].includes(category)) return 9;
  if (planKey === 'enterprise') return 10;
  return 0;
}

function scoreMessage(message, planKey) {
  const ageMinutes = minutesSince(message.receivedAt);
  const freshnessBoost = Math.max(0, 12 - Math.floor(ageMinutes / 30));
  const overduePenalty = message.slaMinutes && ageMinutes > message.slaMinutes ? 22 : 0;
  const score = urgencyWeight(message.urgency)
    + impactWeight(message.customerImpact)
    + revenueWeight(message.revenuePotential)
    + freshnessBoost
    + overduePenalty
    + planBonus(planKey, message.category);

  return {
    score,
    ageMinutes,
    overdue: Boolean(message.slaMinutes && ageMinutes > message.slaMinutes)
  };
}

function bucketForScore(score) {
  if (score >= 80) return 'P1 - direct handelen';
  if (score >= 55) return 'P2 - vandaag afronden';
  if (score >= 28) return 'P3 - plannen / batchen';
  return 'P4 - digest / archiveren';
}

function buildSummary(message, triage) {
  if (message.category === 'sales_opportunity') {
    return `${message.company} vraagt een voorstel voor ${message.entities.join(', ')}. Waarde is potentieel hoog en SortBox markeert dit als ${triage.bucket.toLowerCase()} met duidelijke deadline: ${message.deadlineText}.`;
  }
  if (message.category === 'client_issue') {
    return `${message.company} meldt een operationeel incident met directe klantimpact. Er is snelle bevestiging nodig, plus interne escalatie zodat de bezetting voor vanavond veilig staat.`;
  }
  if (message.category === 'service_request') {
    return `${message.company} kan nu niet doorwerken omdat een badge of toegang blokkeert. SortBox plaatst dit bovenaan vanwege hoge impact, korte SLA en risico op frustratie bij de klant.`;
  }
  if (message.category === 'internal_ops') {
    return `Interne roosterwijziging met klantimpact op korte termijn. Geen omzetkans, wel risico op gaten in de planning als dit niet binnen de ochtend wordt opgepakt.`;
  }
  if (message.category === 'finance') {
    return `Financiële herinnering zonder directe klantimpact. Geschikt voor batchverwerking door finance, tenzij de betaaltermijn verder escaleert.`;
  }
  return `Lage waarde of promotionele mail. SortBox bundelt dit in de digest en haalt het uit de primaire focus.`;
}

function buildReplyDraft(message) {
  const greeting = `Hallo ${message.fromName.split(' ')[0]},`;

  if (message.category === 'sales_opportunity') {
    return `${greeting}\n\nDank voor je bericht. We pakken dit vandaag op en sturen uiterlijk ${message.deadlineText.replace('Voorstel gevraagd voor ', '')} een gericht voorstel voor de locatie in ${message.entities[0]}. Als je wilt meenemen hoeveel posten en welke tijdsblokken nodig zijn, verwerken we dat direct in de offerte.\n\nGroet,\nTeam Praesidion`;
  }
  if (message.category === 'client_issue') {
    return `${greeting}\n\nDank voor het directe signaal. We onderzoeken nu wat er gisteren tussen 18:00 en 18:25 is gebeurd en zorgen vandaag ook voor bevestigde bezetting voor vanavond. Je ontvangt binnen 15 minuten een eerste terugkoppeling met de genomen acties.\n\nGroet,\nOperations Praesidion`;
  }
  if (message.category === 'service_request') {
    return `${greeting}\n\nDank voor je bericht. We zetten dit nu direct uit bij support en checken de badge-status plus het locatiecontact in Sittard. Binnen 20 minuten ontvang je een update met de snelste oplossing en ETA.\n\nGroet,\nSupport Praesidion`;
  }
  if (message.category === 'internal_ops') {
    return `${greeting}\n\nOntvangen. We checken nu direct de beschikbaarheid voor vrijdag 22:00-06:00 in Maastricht en komen vanochtend nog bij je terug met de snelste oplossing.\n\nGroet,\nPlanning`;
  }
  if (message.category === 'finance') {
    return `${greeting}\n\nDank voor de herinnering. We leggen factuur 24-019 vandaag bij finance neer en koppelen terug zodra de status is gecontroleerd.\n\nGroet,\nPraesidion Finance`;
  }
  return `${greeting}\n\nDank voor je bericht. We hebben het ontvangen en verwerken het in de eerstvolgende batch.\n\nGroet,\nSortBox`;
}

function buildActions(message, triage, planKey) {
  const base = [];

  if (triage.bucket.startsWith('P1')) {
    base.push(`Escaleren naar ${message.recommendedOwner} met deadline ${message.deadlineText}`);
    base.push('Conceptantwoord klaarzetten voor directe verzending');
  }

  if (message.category === 'sales_opportunity') {
    base.push('CRM-deal aanmaken met waarde-indicatie en follow-up reminder');
    base.push('Offerte-template openen met locatie en startdatum ingevuld');
  }

  if (message.category === 'client_issue') {
    base.push('Incidenttaak aanmaken voor operations en klantcontact');
    base.push('Escalatie naar duty lead als geen update binnen 15 minuten');
  }

  if (message.category === 'service_request') {
    base.push('Supportticket openen en locatiecontact bellen');
  }

  if (message.category === 'internal_ops') {
    base.push('Planningstaak aanmaken voor vervanging nachtdienst');
  }

  if (message.category === 'finance') {
    base.push('Batch naar finance-queue voor verificatie openstaande factuur');
  }

  if (message.category === 'noise') {
    base.push('Automatisch archiveren en opnemen in dagdigest');
  }

  if (['team', 'ops', 'enterprise'].includes(planKey) && message.recommendedOwner && message.recommendedOwner !== 'None') {
    base.push(`Routeren naar ${message.recommendedOwner} met interne notitie en prioriteitslabel`);
  }

  if (['ops', 'enterprise'].includes(planKey) && triage.overdue) {
    base.push('SLA breach markeren en management-escalatie starten');
  }

  return base;
}

function selectMessages(planKey) {
  if (planKey === 'solo') {
    return BASE_MESSAGES.filter(item => !['internal_ops'].includes(item.category));
  }
  if (planKey === 'pro') {
    return BASE_MESSAGES.filter(item => item.category !== 'noise' || item.id === 'msg-noise-005');
  }
  return BASE_MESSAGES.slice();
}

function generateDemo(planKey = 'team') {
  const normalizedPlan = PLAN_CONFIG[planKey] ? planKey : 'team';
  const messages = selectMessages(normalizedPlan).map((message) => {
    const triage = scoreMessage(message, normalizedPlan);
    const bucket = bucketForScore(triage.score);
    const triageData = {
      ...triage,
      bucket,
      why: [
        `${message.urgency} urgentie`,
        `${message.customerImpact} impact`,
        message.revenuePotential ? `€${message.revenuePotential.toLocaleString('nl-NL')} potentiële waarde` : 'geen directe omzetwaarde',
        triage.overdue ? 'SLA-risico gedetecteerd' : 'binnen SLA-venster'
      ]
    };

    return {
      ...message,
      triage: triageData,
      summary: buildSummary(message, triageData),
      replyDraft: buildReplyDraft(message),
      actions: buildActions(message, triageData, normalizedPlan),
      followUpAt: message.followUpWindowHours
        ? new Date(Date.now() + message.followUpWindowHours * 60 * 60 * 1000).toISOString()
        : null
    };
  }).sort((a, b) => b.triage.score - a.triage.score);

  const priorityCounts = messages.reduce((acc, item) => {
    const key = item.triage.bucket.split(' ')[0];
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const top = messages[0] || null;
  const noiseCount = messages.filter(item => item.category === 'noise').length;
  const totalRevenue = messages.reduce((sum, item) => sum + (item.revenuePotential || 0), 0);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    plan: {
      key: normalizedPlan,
      ...PLAN_CONFIG[normalizedPlan]
    },
    headline: top
      ? `SortBox zet ${top.subject.toLowerCase()} bovenaan en haalt ${noiseCount} ruis-mail${noiseCount === 1 ? '' : 's'} uit beeld.`
      : 'SortBox heeft geen demo-items gevonden.',
    stats: {
      inboxItems: messages.length,
      p1: priorityCounts.P1 || 0,
      p2: priorityCounts.P2 || 0,
      digest: priorityCounts.P4 || 0,
      revenueAtRisk: totalRevenue,
      avgFirstPassSavedMinutes: normalizedPlan === 'solo' ? 28 : normalizedPlan === 'pro' ? 41 : normalizedPlan === 'team' ? 67 : 94
    },
    operatorDigest: [
      top ? `Pak eerst ${top.company}: ${top.deadlineText}.` : 'Geen topitem.',
      `${messages.filter(item => item.triage.bucket.startsWith('P1')).length} berichten vragen directe actie.`,
      `${messages.filter(item => item.actions.some(action => action.includes('Routeren'))).length} berichten kunnen direct naar de juiste owner worden gerouteerd.`,
      `${noiseCount} berichten kunnen zonder denkwerk in digest of archief.`
    ],
    messages
  };
}

module.exports = {
  generateDemo,
  PLAN_CONFIG
};
