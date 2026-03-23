/**
 * SortBox Drip Email Engine
 * Handles onboarding email automation with Resend (primary) + Strato SMTP (fallback)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// ── Paths ──
// Use /tmp on Vercel (read-only filesystem), local dir otherwise
const IS_VERCEL = !!process.env.VERCEL;
const ROOT = IS_VERCEL ? '/tmp' : __dirname;
const DATA_DIR = path.join(ROOT, 'submissions');
const DRIP_DIR = path.join(DATA_DIR, 'drip');
const EMAIL_LOG = path.join(DATA_DIR, 'email-log.jsonl');

// ── Activation Engine Content ──
const ACTIVATION_ENGINE_PATH = path.join(__dirname, '..', 'q557-sortbox-activation-engine.json');
let ACTIVATION_ENGINE = null;
try {
  ACTIVATION_ENGINE = JSON.parse(fs.readFileSync(ACTIVATION_ENGINE_PATH, 'utf8'));
} catch (e) {
  console.error('[drip-engine] Could not load activation engine JSON:', e.message);
}

// ── Drip Schedule ──
const DRIP_DAYS = [0, 1, 3, 7, 14, 27];

// ── Checkout links ──
const CHECKOUT_LINKS = {
  solo: 'https://buy.stripe.com/dRm00i5QjaYBca1bYq3ZK0a',
  pro: 'https://buy.stripe.com/eVq8wOa6z4Ad7TL4vY3ZK0b',
  team: 'https://buy.stripe.com/aFacN43Ib5Eh5LD3rU3ZK0c',
  ops: 'https://buy.stripe.com/eVq00i0vZ8Qt0rj2nQ3ZK0d'
};

// ── Plan prices ──
const PLAN_PRICES = { solo: 49, pro: 149, team: 349, ops: 749 };
const PLAN_LABELS = { solo: 'Solo', pro: 'Pro', team: 'Team', ops: 'Ops' };

// ── Ensure dirs ──
fs.mkdirSync(DRIP_DIR, { recursive: true });
if (!fs.existsSync(EMAIL_LOG)) fs.writeFileSync(EMAIL_LOG, '', 'utf8');

// ── Email Sending ──

/**
 * Send email via Resend API (primary)
 * Uses RESEND_FROM_DOMAIN env var if set, otherwise falls back to snelrie.nl (verified).
 * Always sets reply-to as emily@praesidion.com for proper branding.
 */
async function sendViaResend(apiKey, { from, to, subject, html }) {
  // Use verified Resend domain for sending, keep reply-to as praesidion.com
  const resendDomain = process.env.RESEND_FROM_DOMAIN || 'snelrie.nl';
  const fromName = (from || '').match(/^([^<]*)</)?.[1]?.trim() || 'SortBox';
  const resendFrom = `${fromName} <sortbox@${resendDomain}>`;
  const replyTo = 'emily@praesidion.com';

  const body = JSON.stringify({ from: resendFrom, to: [to], subject, html, reply_to: replyTo });
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Resend API error ${resp.status}: ${JSON.stringify(data)}`);
  }
  return { messageId: data.id, provider: 'resend' };
}

/**
 * Send email via Strato SMTP (fallback)
 */
async function sendViaStrato(smtpUser, smtpPass, { from, to, subject, html }) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.strato.de',
    port: 465,
    secure: true,
    auth: { user: smtpUser, pass: smtpPass }
  });
  const info = await transporter.sendMail({ from, to, subject, html });
  return { messageId: info.messageId, provider: 'strato' };
}

/**
 * Send email with Resend primary, Strato fallback
 */
async function sendEmail(emailOpts) {
  const resendKey = process.env.RESEND_API_KEY;
  const stratoUser = process.env.STRATO_USER;
  const stratoPass = process.env.STRATO_PASS;

  // Try Resend first
  if (resendKey) {
    try {
      return await sendViaResend(resendKey, emailOpts);
    } catch (err) {
      console.error('[drip-engine] Resend failed, falling back to Strato:', err.message);
    }
  }

  // Fallback to Strato
  if (stratoUser && stratoPass) {
    return await sendViaStrato(stratoUser, stratoPass, emailOpts);
  }

  throw new Error('No email provider configured (need RESEND_API_KEY or STRATO_USER+STRATO_PASS)');
}

// ── Email Content Generation ──

function getPlanEmailContent(planKey, day) {
  if (!ACTIVATION_ENGINE) return null;
  const plan = ACTIVATION_ENGINE.plans?.[planKey];
  if (!plan) return null;
  const dayKey = `day${day}`;
  return plan.emails?.[dayKey] || null;
}

function getPlanConfirmation(planKey) {
  if (!ACTIVATION_ENGINE) return null;
  return ACTIVATION_ENGINE.plans?.[planKey]?.confirmation || null;
}

function getSequenceInfo(planKey, day) {
  if (!ACTIVATION_ENGINE) return null;
  const plan = ACTIVATION_ENGINE.plans?.[planKey];
  if (!plan) return null;
  return plan.sequence?.find(s => s.day === day) || null;
}

function trialEndDate(signupDate) {
  const d = new Date(signupDate);
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Generate HTML email for a specific drip day
 */
function generateEmailHtml(lead, day) {
  const planKey = lead.planKey || 'team';
  const emailContent = getPlanEmailContent(planKey, day);
  const confirmation = getPlanConfirmation(planKey);
  const sequenceInfo = getSequenceInfo(planKey, day);
  const planLabel = PLAN_LABELS[planKey] || 'Team';
  const price = PLAN_PRICES[planKey] || 349;
  const checkout = lead.checkout || CHECKOUT_LINKS[planKey] || '#';
  const endDate = trialEndDate(lead.submittedAt || new Date().toISOString());
  const firstName = lead.firstName || 'daar';
  const company = lead.company || 'je organisatie';
  const quickstartUrl = `https://sortbox.praesidion.com/app?leadId=${encodeURIComponent(lead.leadId || '')}`;

  // Subject from activation engine
  const subject = emailContent?.subject || getDripSubjectFallback(planKey, day);

  // Build body content per day
  let bodyContent = '';

  switch (day) {
    case 0:
      bodyContent = buildDay0Body(firstName, company, planLabel, price, confirmation, quickstartUrl, endDate);
      break;
    case 1:
      bodyContent = buildDay1Body(firstName, planLabel, quickstartUrl, sequenceInfo);
      break;
    case 3:
      bodyContent = buildDay3Body(firstName, planLabel, company, sequenceInfo);
      break;
    case 7:
      bodyContent = buildDay7Body(firstName, planLabel, company, sequenceInfo);
      break;
    case 14:
      bodyContent = buildDay14Body(firstName, planLabel, sequenceInfo);
      break;
    case 27:
      bodyContent = buildDay27Body(firstName, planLabel, price, endDate, checkout, sequenceInfo);
      break;
    default:
      bodyContent = `<p>Hoi ${firstName},</p><p>Dit is een update over je SortBox ${planLabel}-trial.</p>`;
  }

  return {
    subject,
    html: wrapInEmailTemplate(bodyContent, planLabel)
  };
}

function getDripSubjectFallback(planKey, day) {
  const subjects = {
    0: `Je SortBox ${PLAN_LABELS[planKey]} staat klaar`,
    1: `Haal vandaag direct winst uit SortBox`,
    3: `Dit ziet SortBox nu in jouw mailbox`,
    7: `Je eerste week met SortBox — de cijfers`,
    14: `SortBox kan nog meer voor je doen`,
    27: `Je gratis maand loopt bijna af`
  };
  return subjects[day] || `SortBox update — dag ${day}`;
}

function buildDay0Body(firstName, company, planLabel, price, confirmation, quickstartUrl, endDate) {
  const whatIsReady = confirmation?.whatIsReady || [];
  const readyList = whatIsReady.map(item => `<li style="margin-bottom:6px;color:#374151;">${item}</li>`).join('');

  return `
    <h2 style="color:#1e3a5f;margin:0 0 16px 0;font-size:22px;">Welkom ${firstName} 👋</h2>
    <p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 16px 0;">
      Je SortBox <strong>${planLabel}</strong>-omgeving voor ${company} is geactiveerd. 
      Je gratis 30 dagen zijn gestart — vandaag betaal je <strong>€0</strong>.
    </p>
    
    <div style="background:#f0f7ff;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="color:#1e3a5f;font-weight:600;margin:0 0 12px 0;font-size:15px;">Dit staat al klaar:</p>
      <ul style="margin:0;padding:0 0 0 20px;list-style:disc;">
        ${readyList}
      </ul>
    </div>

    <div style="text-align:center;margin:28px 0;">
      <a href="${quickstartUrl}" style="background:#1e3a5f;color:#ffffff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block;">
        Open je quickstart →
      </a>
    </div>

    <div style="background:#fafafa;border-left:3px solid #1e3a5f;padding:16px;margin:20px 0;">
      <p style="color:#6b7280;font-size:14px;margin:0;line-height:1.5;">
        <strong>Geen call nodig.</strong> Je setup loopt direct door. 
        Eerste betaling (€${price}/maand) pas op ${endDate} — en alleen als je doorgaat.
        Opzeggen kan altijd, zonder opzegtermijn.
      </p>
    </div>
  `;
}

function buildDay1Body(firstName, planLabel, quickstartUrl, sequenceInfo) {
  return `
    <h2 style="color:#1e3a5f;margin:0 0 16px 0;font-size:22px;">Dag 2 — tijd voor je eerste winst</h2>
    <p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 16px 0;">
      Hoi ${firstName}, je ${planLabel}-omgeving draait nu een dag. Hier zijn drie dingen die je vandaag kunt doen 
      om direct resultaat te zien:
    </p>
    
    <div style="margin:20px 0;">
      <div style="background:#f9fafb;border-radius:6px;padding:16px;margin-bottom:12px;">
        <p style="margin:0;color:#1e3a5f;font-weight:600;">1. Check je prioriteiten</p>
        <p style="margin:6px 0 0 0;color:#6b7280;font-size:14px;">SortBox heeft je inbox gesorteerd op urgentie. Kijk of de volgorde klopt.</p>
      </div>
      <div style="background:#f9fafb;border-radius:6px;padding:16px;margin-bottom:12px;">
        <p style="margin:0;color:#1e3a5f;font-weight:600;">2. Bekijk een conceptantwoord</p>
        <p style="margin:6px 0 0 0;color:#6b7280;font-size:14px;">Voor je belangrijkste mail staat een concept klaar in jouw tone of voice.</p>
      </div>
      <div style="background:#f9fafb;border-radius:6px;padding:16px;margin-bottom:12px;">
        <p style="margin:0;color:#1e3a5f;font-weight:600;">3. Stel je follow-up ritme in</p>
        <p style="margin:6px 0 0 0;color:#6b7280;font-size:14px;">Bepaal wanneer je een herinnering wilt bij onbeantwoorde mails.</p>
      </div>
    </div>

    <div style="text-align:center;margin:24px 0;">
      <a href="${quickstartUrl}" style="background:#1e3a5f;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
        Ga naar je dashboard →
      </a>
    </div>
  `;
}

function buildDay3Body(firstName, planLabel, company, sequenceInfo) {
  return `
    <h2 style="color:#1e3a5f;margin:0 0 16px 0;font-size:22px;">Je eerste patronen worden zichtbaar</h2>
    <p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 16px 0;">
      Hoi ${firstName}, na drie dagen begint SortBox ${planLabel} de structuur in je mailbox van ${company} te herkennen.
    </p>
    
    <div style="background:#f0f7ff;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="color:#1e3a5f;font-weight:600;margin:0 0 8px 0;">Wat SortBox nu ziet:</p>
      <ul style="margin:0;padding:0 0 0 20px;color:#374151;line-height:1.8;">
        <li>Welke mailtypes het vaakst binnenkomen</li>
        <li>Waar de meeste reactietijd in gaat zitten</li>
        <li>Welke mails vanzelf kunnen wachten</li>
        <li>Waar follow-up nodig is maar uitblijft</li>
      </ul>
    </div>

    <p style="color:#374151;font-size:16px;line-height:1.6;">
      Check je dashboard om te zien of de categorisering en prioriteiten kloppen. 
      Eén kleine aanpassing nu maakt de rest van je trial een stuk scherper.
    </p>
  `;
}

function buildDay7Body(firstName, planLabel, company, sequenceInfo) {
  return `
    <h2 style="color:#1e3a5f;margin:0 0 16px 0;font-size:22px;">Je eerste week met ${planLabel} 📊</h2>
    <p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 16px 0;">
      Hoi ${firstName}, je eerste volledige week met SortBox ${planLabel} zit erop. 
      Tijd om te kijken wat het al oplevert.
    </p>
    
    <div style="background:#ecfdf5;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="color:#065f46;font-weight:600;margin:0 0 12px 0;">Wat er nu anders is:</p>
      <ul style="margin:0;padding:0 0 0 20px;color:#374151;line-height:1.8;">
        <li>Prioriteiten worden automatisch gesorteerd</li>
        <li>Conceptantwoorden staan klaar voor je belangrijkste mails</li>
        <li>Follow-ups worden bijgehouden zonder handmatig werk</li>
        <li>Je besteedt minder tijd aan inbox-triage</li>
      </ul>
    </div>

    <p style="color:#374151;font-size:16px;line-height:1.6;">
      Het verschil moet nu voelbaar zijn. Als dat zo is, hoef je niets te veranderen — 
      je setup wordt alleen maar slimmer naarmate er meer data doorheen stroomt.
    </p>
  `;
}

function buildDay14Body(firstName, planLabel, sequenceInfo) {
  return `
    <h2 style="color:#1e3a5f;margin:0 0 16px 0;font-size:22px;">Halverwege — en er is meer mogelijk</h2>
    <p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 16px 0;">
      Hoi ${firstName}, je bent halverwege je gratis ${planLabel}-maand. 
      Je basis staat, maar er is nog een laag die je kunt activeren.
    </p>
    
    <div style="background:#fffbeb;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="color:#92400e;font-weight:600;margin:0 0 8px 0;">💡 Tip voor deze week:</p>
      <p style="color:#374151;font-size:15px;margin:0;line-height:1.6;">
        Kijk naar de mails die SortBox als P2 of P3 labelt. 
        Als daar iets tussen zit dat eigenlijk P1 moet zijn, pas je prioriteitsregels aan.
        Eén kleine tweak, groot verschil in de rest van je trial.
      </p>
    </div>

    <p style="color:#6b7280;font-size:14px;line-height:1.5;">
      Vragen of feedback? Reply op deze mail of mail emily@praesidion.com.
    </p>
  `;
}

function buildDay27Body(firstName, planLabel, price, endDate, checkout, sequenceInfo) {
  return `
    <h2 style="color:#1e3a5f;margin:0 0 16px 0;font-size:22px;">Je gratis maand loopt bijna af</h2>
    <p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 16px 0;">
      Hoi ${firstName}, over 3 dagen eindigt je gratis ${planLabel}-periode.
    </p>
    
    <div style="background:#f0f7ff;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="color:#1e3a5f;font-weight:600;margin:0 0 12px 0;">Wat er gebeurt:</p>
      <ul style="margin:0;padding:0 0 0 20px;color:#374151;line-height:1.8;">
        <li>Als SortBox je al rust, snelheid of grip oplevert: <strong>je hoeft niets te doen</strong>. 
            Je ${planLabel}-plan loopt door voor €${price}/maand.</li>
        <li>Wil je stoppen? Dat kan zonder opzegtermijn, zonder verborgen kosten.</li>
        <li>Je betaalt pas op ${endDate} — en alleen als je doorgaat.</li>
      </ul>
    </div>

    <div style="text-align:center;margin:24px 0;">
      <a href="${checkout}" style="background:#1e3a5f;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
        Bekijk je plan & facturatie →
      </a>
    </div>

    <p style="color:#6b7280;font-size:14px;line-height:1.5;">
      Opzeggen? Reply op deze mail of mail emily@praesidion.com. Geen gedoe, geen vragen.
    </p>
  `;
}

function wrapInEmailTemplate(bodyContent, planLabel) {
  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <!-- Header -->
    <div style="background:#1e3a5f;border-radius:8px 8px 0 0;padding:24px 32px;text-align:center;">
      <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;">
        📬 SortBox
      </h1>
      <p style="color:#93c5fd;margin:6px 0 0 0;font-size:13px;">${planLabel} Plan</p>
    </div>
    
    <!-- Body -->
    <div style="background:#ffffff;padding:32px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
      ${bodyContent}
    </div>
    
    <!-- Footer -->
    <div style="background:#f9fafb;border-radius:0 0 8px 8px;padding:20px 32px;border:1px solid #e5e7eb;border-top:none;">
      <p style="color:#9ca3af;font-size:12px;margin:0;line-height:1.5;text-align:center;">
        SortBox by Praesidion Security B.V.<br>
        <a href="mailto:emily@praesidion.com" style="color:#6b7280;">emily@praesidion.com</a> · 
        <a href="tel:0462402401" style="color:#6b7280;">046 240 2401</a><br>
        Je ontvangt deze mail omdat je een SortBox trial hebt gestart.
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ── Drip File Management ──

function getDripFilePath(leadId) {
  return path.join(DRIP_DIR, `${leadId}.json`);
}

function readDripFile(leadId) {
  const filePath = getDripFilePath(leadId);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeDripFile(leadId, data) {
  const filePath = getDripFilePath(leadId);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * Initialize drip schedule for a new lead
 */
function initDripSchedule(lead) {
  const leadId = lead.leadId || lead.canonicalLeadId;
  const signupDate = new Date(lead.submittedAt || new Date().toISOString());
  const planKey = lead.planKey || 'team';

  const schedule = DRIP_DAYS.map(day => {
    const sendDate = new Date(signupDate);
    sendDate.setDate(sendDate.getDate() + day);
    return {
      day,
      scheduledFor: sendDate.toISOString(),
      sent: false,
      sentAt: null,
      messageId: null,
      provider: null,
      error: null
    };
  });

  const dripData = {
    leadId,
    email: lead.email,
    firstName: lead.firstName,
    lastName: lead.lastName,
    company: lead.company,
    planKey,
    checkout: lead.checkout || CHECKOUT_LINKS[planKey] || null,
    signupDate: signupDate.toISOString(),
    trialEndDate: trialEndDate(signupDate.toISOString()),
    schedule,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  writeDripFile(leadId, dripData);
  return dripData;
}

/**
 * Log email to JSONL
 */
function logEmail(entry) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    leadId: entry.leadId || null,
    day: entry.day,
    subject: entry.subject || null,
    to: entry.to || null,
    messageId: entry.messageId || null,
    provider: entry.provider || null,
    status: entry.status || 'unknown',
    error: entry.error || null
  });
  fs.appendFileSync(EMAIL_LOG, line + '\n', 'utf8');
}

/**
 * Send a specific drip email for a lead
 */
async function sendDripEmail(leadId, day) {
  const drip = readDripFile(leadId);
  if (!drip) throw new Error(`No drip schedule found for lead ${leadId}`);

  const scheduleEntry = drip.schedule.find(s => s.day === day);
  if (!scheduleEntry) throw new Error(`Day ${day} not in schedule for lead ${leadId}`);
  if (scheduleEntry.sent) {
    return { alreadySent: true, sentAt: scheduleEntry.sentAt, messageId: scheduleEntry.messageId };
  }

  // Build lead object for email generation
  const lead = {
    leadId: drip.leadId,
    firstName: drip.firstName,
    lastName: drip.lastName,
    email: drip.email,
    company: drip.company,
    planKey: drip.planKey,
    checkout: drip.checkout,
    submittedAt: drip.signupDate
  };

  const { subject, html } = generateEmailHtml(lead, day);

  try {
    const result = await sendEmail({
      from: 'Emily <emily@praesidion.com>',
      to: drip.email,
      subject,
      html
    });

    // Update drip file
    scheduleEntry.sent = true;
    scheduleEntry.sentAt = new Date().toISOString();
    scheduleEntry.messageId = result.messageId;
    scheduleEntry.provider = result.provider;
    drip.updatedAt = new Date().toISOString();
    writeDripFile(leadId, drip);

    // Log
    logEmail({
      leadId,
      day,
      subject,
      to: drip.email,
      messageId: result.messageId,
      provider: result.provider,
      status: 'sent'
    });

    return { sent: true, messageId: result.messageId, provider: result.provider, subject };
  } catch (err) {
    // Log failure
    scheduleEntry.error = err.message;
    drip.updatedAt = new Date().toISOString();
    writeDripFile(leadId, drip);

    logEmail({
      leadId,
      day,
      subject,
      to: drip.email,
      messageId: null,
      status: 'failed',
      error: err.message
    });

    throw err;
  }
}

/**
 * Send day-0 welcome email immediately after signup
 */
async function sendWelcomeEmail(lead) {
  const leadId = lead.leadId || lead.canonicalLeadId;

  // Initialize drip schedule
  let drip = readDripFile(leadId);
  if (!drip) {
    drip = initDripSchedule(lead);
  }

  // Send day 0
  return await sendDripEmail(leadId, 0);
}

/**
 * Check and send all pending drip emails across all leads
 */
async function processDripQueue() {
  const now = new Date();
  const results = { checked: 0, sent: 0, errors: 0, skipped: 0, details: [] };

  let files;
  try {
    files = fs.readdirSync(DRIP_DIR).filter(f => f.endsWith('.json'));
  } catch {
    return results;
  }

  for (const file of files) {
    const leadId = file.replace('.json', '');
    const drip = readDripFile(leadId);
    if (!drip || !drip.schedule) continue;

    results.checked++;

    for (const entry of drip.schedule) {
      if (entry.sent) continue;

      const scheduledFor = new Date(entry.scheduledFor);
      if (scheduledFor > now) {
        results.skipped++;
        continue;
      }

      // Time to send
      try {
        const result = await sendDripEmail(leadId, entry.day);
        if (result.alreadySent) {
          results.skipped++;
        } else {
          results.sent++;
          results.details.push({
            leadId,
            day: entry.day,
            messageId: result.messageId,
            provider: result.provider
          });
        }
      } catch (err) {
        results.errors++;
        results.details.push({
          leadId,
          day: entry.day,
          error: err.message
        });
      }
    }
  }

  console.log(`[drip-engine] Queue processed: checked=${results.checked} sent=${results.sent} errors=${results.errors} skipped=${results.skipped}`);
  return results;
}

/**
 * Get drip status for a lead
 */
function getDripStatus(leadId) {
  const drip = readDripFile(leadId);
  if (!drip) return null;

  const now = new Date();
  return {
    leadId: drip.leadId,
    email: drip.email,
    firstName: drip.firstName,
    company: drip.company,
    planKey: drip.planKey,
    signupDate: drip.signupDate,
    trialEndDate: drip.trialEndDate,
    schedule: drip.schedule.map(entry => ({
      day: entry.day,
      scheduledFor: entry.scheduledFor,
      sent: entry.sent,
      sentAt: entry.sentAt,
      messageId: entry.messageId,
      provider: entry.provider,
      error: entry.error,
      isPast: new Date(entry.scheduledFor) <= now,
      isPending: !entry.sent && new Date(entry.scheduledFor) <= now
    })),
    updatedAt: drip.updatedAt
  };
}

/**
 * Start periodic drip processor (every 30 minutes)
 */
let dripInterval = null;
function startDripScheduler() {
  // Run immediately on start
  processDripQueue().catch(err => console.error('[drip-engine] Initial queue error:', err.message));

  // Then every 30 minutes
  dripInterval = setInterval(() => {
    processDripQueue().catch(err => console.error('[drip-engine] Periodic queue error:', err.message));
  }, 30 * 60 * 1000);

  console.log('[drip-engine] Drip scheduler started (every 30 min)');
}

function stopDripScheduler() {
  if (dripInterval) {
    clearInterval(dripInterval);
    dripInterval = null;
  }
}

module.exports = {
  sendWelcomeEmail,
  sendDripEmail,
  processDripQueue,
  getDripStatus,
  initDripSchedule,
  startDripScheduler,
  stopDripScheduler,
  generateEmailHtml,
  logEmail
};
