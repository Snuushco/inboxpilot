/**
 * InboxPilot Drip Engine (Serverless)
 * Simplified for on-demand processing via API calls.
 */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const store = require('./store');

const DRIP_DAYS = [0, 1, 3, 7, 14, 27];
const PLAN_PRICES = { solo: 49, pro: 149, team: 349, ops: 749 };
const PLAN_LABELS = { solo: 'Solo', pro: 'Pro', team: 'Team', ops: 'Ops' };

function getDripFilePath(leadId) {
  return path.join(store.DRIP_DIR, `${leadId}.json`);
}

function readDripFile(leadId) {
  try { return JSON.parse(fs.readFileSync(getDripFilePath(leadId), 'utf8')); } catch { return null; }
}

function writeDripFile(leadId, data) {
  store.writeJsonAtomic(getDripFilePath(leadId), data);
}

function trialEndDate(signupDate) {
  const d = new Date(signupDate);
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

function initDripSchedule(lead) {
  store.initStore();
  const leadId = lead.leadId || lead.canonicalLeadId;
  const signupDate = new Date(lead.submittedAt || new Date().toISOString());
  const planKey = lead.planKey || 'team';

  const schedule = DRIP_DAYS.map(day => {
    const sendDate = new Date(signupDate);
    sendDate.setDate(sendDate.getDate() + day);
    return { day, scheduledFor: sendDate.toISOString(), sent: false, sentAt: null, messageId: null, provider: null, error: null };
  });

  const dripData = {
    leadId, email: lead.email, firstName: lead.firstName, lastName: lead.lastName,
    company: lead.company, planKey, checkout: lead.checkout || store.CHECKOUT_LINKS[planKey] || null,
    signupDate: signupDate.toISOString(), trialEndDate: trialEndDate(signupDate.toISOString()),
    schedule, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };

  writeDripFile(leadId, dripData);
  return dripData;
}

async function sendEmail(emailOpts) {
  const stratoUser = process.env.STRATO_USER;
  const stratoPass = process.env.STRATO_PASS;
  if (stratoUser && stratoPass) {
    const transporter = nodemailer.createTransport({
      host: process.env.STRATO_HOST || 'smtp.strato.de',
      port: Number(process.env.STRATO_PORT || 465),
      secure: true,
      auth: { user: stratoUser, pass: stratoPass }
    });
    const info = await transporter.sendMail(emailOpts);
    return { messageId: info.messageId, provider: 'strato' };
  }
  throw new Error('No email provider configured (need STRATO_USER+STRATO_PASS)');
}

function wrapInEmailTemplate(bodyContent, planLabel) {
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
<div style="background:#1e3a5f;border-radius:8px 8px 0 0;padding:24px 32px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;">📬 InboxPilot</h1>
<p style="color:#93c5fd;margin:6px 0 0 0;font-size:13px;">${planLabel} Plan</p></div>
<div style="background:#ffffff;padding:32px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">${bodyContent}</div>
<div style="background:#f9fafb;border-radius:0 0 8px 8px;padding:20px 32px;border:1px solid #e5e7eb;border-top:none;">
<p style="color:#9ca3af;font-size:12px;margin:0;line-height:1.5;text-align:center;">
InboxPilot by Praesidion Security B.V.<br>
<a href="mailto:emily@praesidion.com" style="color:#6b7280;">emily@praesidion.com</a> · 
<a href="tel:0462402401" style="color:#6b7280;">046 240 2401</a></p></div></div></body></html>`;
}

function generateEmailHtml(lead, day) {
  const planKey = lead.planKey || 'team';
  const planLabel = PLAN_LABELS[planKey] || 'Team';
  const price = PLAN_PRICES[planKey] || 349;
  const firstName = lead.firstName || 'daar';
  const company = lead.company || 'je organisatie';
  const endDate = trialEndDate(lead.submittedAt || new Date().toISOString());

  const subjects = {
    0: `Je InboxPilot ${planLabel} staat klaar`,
    1: `Haal vandaag direct winst uit InboxPilot`,
    3: `Dit ziet InboxPilot nu in jouw mailbox`,
    7: `Je eerste week met InboxPilot — de cijfers`,
    14: `InboxPilot kan nog meer voor je doen`,
    27: `Je gratis maand loopt bijna af`
  };

  const bodies = {
    0: `<h2 style="color:#1e3a5f;">Welkom ${firstName} 👋</h2><p>Je InboxPilot <strong>${planLabel}</strong> voor ${company} is geactiveerd. 30 dagen gratis — vandaag betaal je <strong>€0</strong>.</p>`,
    1: `<h2 style="color:#1e3a5f;">Dag 2 — tijd voor je eerste winst</h2><p>Hoi ${firstName}, check je prioriteiten, bekijk een conceptantwoord, stel je follow-up ritme in.</p>`,
    3: `<h2 style="color:#1e3a5f;">Je eerste patronen worden zichtbaar</h2><p>Na drie dagen begint InboxPilot de structuur in je mailbox van ${company} te herkennen.</p>`,
    7: `<h2 style="color:#1e3a5f;">Je eerste week met ${planLabel} 📊</h2><p>Het verschil moet nu voelbaar zijn. Prioriteiten, conceptantwoorden en follow-ups worden automatisch bijgehouden.</p>`,
    14: `<h2 style="color:#1e3a5f;">Halverwege — en er is meer mogelijk</h2><p>Je bent halverwege je gratis ${planLabel}-maand. Pas je prioriteitsregels aan voor nog scherpere resultaten.</p>`,
    27: `<h2 style="color:#1e3a5f;">Je gratis maand loopt bijna af</h2><p>Over 3 dagen eindigt je gratis ${planLabel}-periode. Niets doen = doorgaan voor €${price}/maand. Opzeggen kan altijd.</p>`
  };

  return {
    subject: subjects[day] || `InboxPilot update — dag ${day}`,
    html: wrapInEmailTemplate(bodies[day] || `<p>Hoi ${firstName}, update over je InboxPilot trial.</p>`, planLabel)
  };
}

async function sendDripEmail(leadId, day) {
  store.initStore();
  const drip = readDripFile(leadId);
  if (!drip) throw new Error(`No drip schedule found for lead ${leadId}`);
  const entry = drip.schedule.find(s => s.day === day);
  if (!entry) throw new Error(`Day ${day} not in schedule`);
  if (entry.sent) return { alreadySent: true, sentAt: entry.sentAt, messageId: entry.messageId };

  const { subject, html } = generateEmailHtml(drip, day);
  const result = await sendEmail({ from: 'Emily <emily@praesidion.com>', to: drip.email, subject, html });

  entry.sent = true;
  entry.sentAt = new Date().toISOString();
  entry.messageId = result.messageId;
  entry.provider = result.provider;
  drip.updatedAt = new Date().toISOString();
  writeDripFile(leadId, drip);

  store.appendJsonLine(store.EMAIL_LOG, {
    timestamp: new Date().toISOString(), leadId, day, subject, to: drip.email,
    messageId: result.messageId, provider: result.provider, status: 'sent'
  });

  return { sent: true, messageId: result.messageId, provider: result.provider, subject };
}

async function sendWelcomeEmail(lead) {
  const leadId = lead.leadId || lead.canonicalLeadId;
  let drip = readDripFile(leadId);
  if (!drip) drip = initDripSchedule(lead);
  return await sendDripEmail(leadId, 0);
}

async function processDripQueue() {
  store.initStore();
  const now = new Date();
  const results = { checked: 0, sent: 0, errors: 0, skipped: 0, details: [] };
  let files;
  try { files = fs.readdirSync(store.DRIP_DIR).filter(f => f.endsWith('.json')); } catch { return results; }

  for (const file of files) {
    const leadId = file.replace('.json', '');
    const drip = readDripFile(leadId);
    if (!drip || !drip.schedule) continue;
    results.checked++;
    for (const entry of drip.schedule) {
      if (entry.sent) continue;
      if (new Date(entry.scheduledFor) > now) { results.skipped++; continue; }
      try {
        const result = await sendDripEmail(leadId, entry.day);
        if (result.alreadySent) results.skipped++;
        else { results.sent++; results.details.push({ leadId, day: entry.day, messageId: result.messageId }); }
      } catch (err) {
        results.errors++;
        results.details.push({ leadId, day: entry.day, error: err.message });
      }
    }
  }
  return results;
}

function getDripStatus(leadId) {
  const drip = readDripFile(leadId);
  if (!drip) return null;
  const now = new Date();
  return {
    leadId: drip.leadId, email: drip.email, firstName: drip.firstName,
    company: drip.company, planKey: drip.planKey, signupDate: drip.signupDate,
    trialEndDate: drip.trialEndDate,
    schedule: drip.schedule.map(entry => ({
      ...entry, isPast: new Date(entry.scheduledFor) <= now,
      isPending: !entry.sent && new Date(entry.scheduledFor) <= now
    })),
    updatedAt: drip.updatedAt
  };
}

module.exports = {
  sendWelcomeEmail, sendDripEmail, processDripQueue,
  getDripStatus, initDripSchedule, generateEmailHtml
};
