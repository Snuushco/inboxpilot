/**
 * SortBox MVP — Stripe Billing Module
 * 
 * Handles webhook events, subscription state, access gating, and trial reminders.
 * Billing state per lead stored in: submissions/billing/{leadId}.json
 * 
 * IMPORTANT: Stripe webhook secret is NEVER hardcoded.
 * MVP grace: if STRIPE_WEBHOOK_SECRET is not set, events are processed with a warning log.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BILLING_DIR = path.join(__dirname, 'submissions', 'billing');
const BILLING_LOG = path.join(__dirname, 'submissions', 'billing-events.jsonl');

// Lazy-loaded drip engine reference (set via setBillingDripEngine)
let _dripEngine = null;
function setBillingDripEngine(drip) { _dripEngine = drip; }

// Plan price mapping (monthly EUR) — must match Stripe products
const PLAN_PRICES = {
  solo: 4900,   // €49 in cents
  pro: 14900,   // €149
  team: 34900,  // €349
  ops: 74900    // €749
};

const PRICE_TO_PLAN = {};
// Will be populated dynamically from Stripe events

// ── Directory setup ──
function ensureBillingDir() {
  fs.mkdirSync(BILLING_DIR, { recursive: true });
}

// ── Billing state CRUD ──
function billingPath(leadId) {
  if (!leadId || typeof leadId !== 'string') return null;
  // Sanitize leadId to prevent path traversal
  const safe = leadId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(BILLING_DIR, `${safe}.json`);
}

function readBillingState(leadId) {
  const fp = billingPath(leadId);
  if (!fp) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function writeBillingState(leadId, state) {
  ensureBillingDir();
  const fp = billingPath(leadId);
  if (!fp) return false;
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, fp);
  return true;
}

function findLeadByStripeCustomer(customerId) {
  ensureBillingDir();
  try {
    const files = fs.readdirSync(BILLING_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(BILLING_DIR, file), 'utf8'));
        if (data.stripeCustomerId === customerId) {
          return data;
        }
      } catch { /* skip corrupt files */ }
    }
  } catch { /* dir doesn't exist yet */ }
  return null;
}

function findLeadBySubscriptionId(subscriptionId) {
  ensureBillingDir();
  try {
    const files = fs.readdirSync(BILLING_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(BILLING_DIR, file), 'utf8'));
        if (data.subscriptionId === subscriptionId) {
          return data;
        }
      } catch { /* skip corrupt files */ }
    }
  } catch { /* dir doesn't exist yet */ }
  return null;
}

// ── Logging ──
function logBillingEvent(event) {
  ensureBillingDir();
  const line = JSON.stringify({
    ...event,
    processedAt: new Date().toISOString()
  });
  fs.appendFileSync(BILLING_LOG, line + '\n', 'utf8');
}

// ── Webhook Signature Verification ──
function verifyStripeSignature(payload, sigHeader, secret) {
  if (!secret) {
    console.warn('[BILLING] ⚠️  STRIPE_WEBHOOK_SECRET not configured — processing without signature verification (MVP grace mode)');
    return { verified: false, reason: 'no_secret_configured' };
  }
  if (!sigHeader) {
    return { verified: false, reason: 'no_signature_header', reject: true };
  }

  try {
    const elements = sigHeader.split(',');
    const tsElement = elements.find(e => e.startsWith('t='));
    const sigElements = elements.filter(e => e.startsWith('v1='));

    if (!tsElement || sigElements.length === 0) {
      return { verified: false, reason: 'malformed_signature', reject: true };
    }

    const timestamp = tsElement.slice(2);
    const expectedSigs = sigElements.map(e => e.slice(3));

    // Check timestamp tolerance (5 minutes)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
      return { verified: false, reason: 'timestamp_too_old', reject: true };
    }

    // Compute expected signature
    const signedPayload = `${timestamp}.${payload}`;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(signedPayload, 'utf8')
      .digest('hex');

    const match = expectedSigs.some(sig =>
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))
    );

    if (!match) {
      return { verified: false, reason: 'signature_mismatch', reject: true };
    }

    return { verified: true };
  } catch (err) {
    return { verified: false, reason: `verification_error: ${err.message}`, reject: true };
  }
}

// ── Price/Plan resolution ──
function resolvePlanFromAmount(amountInCents) {
  for (const [plan, price] of Object.entries(PLAN_PRICES)) {
    if (price === amountInCents) return plan;
  }
  return null;
}

function resolvePlanFromLineItems(lineItems) {
  if (!lineItems || !lineItems.data || !lineItems.data.length) return null;
  const item = lineItems.data[0];
  if (item.price && item.price.unit_amount) {
    return resolvePlanFromAmount(item.price.unit_amount);
  }
  if (item.amount_total) {
    return resolvePlanFromAmount(item.amount_total);
  }
  return null;
}

function resolvePlanFromSubscription(subscription) {
  if (!subscription || !subscription.items || !subscription.items.data) return null;
  const item = subscription.items.data[0];
  if (item && item.price && item.price.unit_amount) {
    return resolvePlanFromAmount(item.price.unit_amount);
  }
  return null;
}

// ── Event Handlers ──

function handleCheckoutCompleted(session) {
  const customerId = session.customer;
  const subscriptionId = session.subscription;
  const customerEmail = session.customer_email || session.customer_details?.email;
  const leadId = session.client_reference_id || session.metadata?.leadId;

  if (!leadId) {
    console.warn('[BILLING] checkout.session.completed without leadId in client_reference_id or metadata — skipping link');
    logBillingEvent({
      type: 'checkout.session.completed',
      status: 'skipped_no_leadId',
      customerId,
      subscriptionId,
      customerEmail
    });
    return { ok: false, reason: 'no_leadId' };
  }

  const plan = resolvePlanFromLineItems(session.line_items) || session.metadata?.plan || null;

  // Determine trial end
  let trialEnd = null;
  if (session.subscription_data?.trial_end) {
    trialEnd = new Date(session.subscription_data.trial_end * 1000).toISOString();
  } else {
    // Default 30-day trial
    trialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  const billingState = {
    leadId,
    stripeCustomerId: customerId,
    subscriptionId,
    customerEmail: customerEmail || null,
    plan: plan || 'unknown',
    status: 'trialing',
    currentPeriodEnd: trialEnd,
    trialEnd,
    reminderDue: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events: [{
      type: 'checkout.session.completed',
      at: new Date().toISOString(),
      sessionId: session.id
    }]
  };

  writeBillingState(leadId, billingState);
  logBillingEvent({
    type: 'checkout.session.completed',
    status: 'success',
    leadId,
    customerId,
    subscriptionId,
    plan
  });

  console.log(`[BILLING] ✅ Checkout completed: lead=${leadId} plan=${plan} customer=${customerId}`);
  return { ok: true, leadId, plan, status: 'trialing' };
}

function handleSubscriptionUpdated(subscription) {
  const customerId = subscription.customer;
  const subscriptionId = subscription.id;

  // Find existing billing state
  let state = findLeadBySubscriptionId(subscriptionId) || findLeadByStripeCustomer(customerId);
  if (!state) {
    console.warn(`[BILLING] subscription.updated for unknown customer=${customerId} sub=${subscriptionId}`);
    logBillingEvent({ type: 'customer.subscription.updated', status: 'skipped_unknown', customerId, subscriptionId });
    return { ok: false, reason: 'unknown_customer' };
  }

  const plan = resolvePlanFromSubscription(subscription) || state.plan;
  const stripeStatus = subscription.status; // trialing, active, past_due, canceled, unpaid, incomplete
  
  // Map Stripe status
  let mappedStatus = stripeStatus;
  if (['incomplete', 'incomplete_expired', 'unpaid'].includes(stripeStatus)) {
    mappedStatus = 'past_due';
  }

  state.plan = plan;
  state.status = mappedStatus;
  state.subscriptionId = subscriptionId;
  state.currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : state.currentPeriodEnd;
  state.trialEnd = subscription.trial_end
    ? new Date(subscription.trial_end * 1000).toISOString()
    : state.trialEnd;
  state.updatedAt = new Date().toISOString();
  state.events = state.events || [];
  state.events.push({
    type: 'customer.subscription.updated',
    at: new Date().toISOString(),
    status: mappedStatus,
    plan
  });

  // Check trial reminder (3 days before trial end)
  checkTrialReminder(state);

  writeBillingState(state.leadId, state);
  logBillingEvent({
    type: 'customer.subscription.updated',
    status: 'success',
    leadId: state.leadId,
    plan,
    subscriptionStatus: mappedStatus
  });

  console.log(`[BILLING] 🔄 Subscription updated: lead=${state.leadId} status=${mappedStatus} plan=${plan}`);
  return { ok: true, leadId: state.leadId, status: mappedStatus, plan };
}

function handleSubscriptionDeleted(subscription) {
  const customerId = subscription.customer;
  const subscriptionId = subscription.id;

  let state = findLeadBySubscriptionId(subscriptionId) || findLeadByStripeCustomer(customerId);
  if (!state) {
    console.warn(`[BILLING] subscription.deleted for unknown customer=${customerId}`);
    logBillingEvent({ type: 'customer.subscription.deleted', status: 'skipped_unknown', customerId, subscriptionId });
    return { ok: false, reason: 'unknown_customer' };
  }

  state.status = 'canceled';
  state.canceledAt = new Date().toISOString();
  state.updatedAt = new Date().toISOString();
  state.events = state.events || [];
  state.events.push({
    type: 'customer.subscription.deleted',
    at: new Date().toISOString()
  });

  writeBillingState(state.leadId, state);
  logBillingEvent({
    type: 'customer.subscription.deleted',
    status: 'success',
    leadId: state.leadId
  });

  console.log(`[BILLING] ❌ Subscription canceled: lead=${state.leadId}`);
  return { ok: true, leadId: state.leadId, status: 'canceled' };
}

function handleInvoicePaid(invoice) {
  const customerId = invoice.customer;
  const subscriptionId = invoice.subscription;

  let state = findLeadBySubscriptionId(subscriptionId) || findLeadByStripeCustomer(customerId);
  if (!state) {
    console.warn(`[BILLING] invoice.paid for unknown customer=${customerId}`);
    logBillingEvent({ type: 'invoice.paid', status: 'skipped_unknown', customerId, subscriptionId });
    return { ok: false, reason: 'unknown_customer' };
  }

  // Detect if this is a recovery from past_due
  const wasRecovery = state.status === 'past_due';
  
  // Successful payment → ensure status is active (unless still trialing)
  if (state.status !== 'trialing') {
    state.status = 'active';
  }
  state.lastPaymentAt = new Date().toISOString();
  state.updatedAt = new Date().toISOString();
  
  // Reset payment failure count on successful payment
  if (wasRecovery) {
    state.paymentFailureCount = 0;
    state.lastPaymentFailedAt = null;
  }
  
  // Update period end from invoice if available
  if (invoice.lines && invoice.lines.data && invoice.lines.data[0]) {
    const line = invoice.lines.data[0];
    if (line.period && line.period.end) {
      state.currentPeriodEnd = new Date(line.period.end * 1000).toISOString();
    }
  }

  state.events = state.events || [];
  state.events.push({
    type: 'invoice.paid',
    at: new Date().toISOString(),
    invoiceId: invoice.id,
    amountPaid: invoice.amount_paid,
    wasRecovery
  });

  writeBillingState(state.leadId, state);
  logBillingEvent({
    type: 'invoice.paid',
    status: 'success',
    leadId: state.leadId,
    invoiceId: invoice.id,
    amountPaid: invoice.amount_paid,
    wasRecovery
  });

  console.log(`[BILLING] 💰 Invoice paid: lead=${state.leadId} amount=${invoice.amount_paid}${wasRecovery ? ' (RECOVERY)' : ''}`);
  return { ok: true, leadId: state.leadId, status: state.status, wasRecovery };
}

function handleTrialWillEnd(subscription) {
  const customerId = subscription.customer;
  const subscriptionId = subscription.id;

  let state = findLeadBySubscriptionId(subscriptionId) || findLeadByStripeCustomer(customerId);
  if (!state) {
    console.warn(`[BILLING] trial_will_end for unknown customer=${customerId}`);
    logBillingEvent({ type: 'customer.subscription.trial_will_end', status: 'skipped_unknown', customerId, subscriptionId });
    return { ok: false, reason: 'unknown_customer' };
  }

  state.reminderDue = true;
  state.reminderDueAt = new Date().toISOString();
  state.updatedAt = new Date().toISOString();
  state.events = state.events || [];
  state.events.push({
    type: 'customer.subscription.trial_will_end',
    at: new Date().toISOString(),
    trialEnd: subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : state.trialEnd
  });

  writeBillingState(state.leadId, state);
  logBillingEvent({
    type: 'customer.subscription.trial_will_end',
    status: 'success',
    leadId: state.leadId
  });

  // Trigger day-27 drip email if not already sent
  triggerBillingEmail(state.leadId, 'trial_ending');

  console.log(`[BILLING] ⏰ Trial will end: lead=${state.leadId}`);
  return { ok: true, leadId: state.leadId, status: 'trial_ending_soon' };
}

function handleInvoicePaymentFailed(invoice) {
  const customerId = invoice.customer;
  const subscriptionId = invoice.subscription;

  let state = findLeadBySubscriptionId(subscriptionId) || findLeadByStripeCustomer(customerId);
  if (!state) {
    console.warn(`[BILLING] invoice.payment_failed for unknown customer=${customerId}`);
    logBillingEvent({ type: 'invoice.payment_failed', status: 'skipped_unknown', customerId, subscriptionId });
    return { ok: false, reason: 'unknown_customer' };
  }

  state.status = 'past_due';
  state.lastPaymentFailedAt = new Date().toISOString();
  state.paymentFailureCount = (state.paymentFailureCount || 0) + 1;
  state.updatedAt = new Date().toISOString();
  state.events = state.events || [];
  state.events.push({
    type: 'invoice.payment_failed',
    at: new Date().toISOString(),
    invoiceId: invoice.id,
    attemptCount: invoice.attempt_count
  });

  writeBillingState(state.leadId, state);
  logBillingEvent({
    type: 'invoice.payment_failed',
    status: 'success',
    leadId: state.leadId,
    invoiceId: invoice.id,
    attemptCount: invoice.attempt_count
  });

  console.log(`[BILLING] ⚠️  Payment failed: lead=${state.leadId} attempts=${invoice.attempt_count}`);
  return { ok: true, leadId: state.leadId, status: 'past_due', sendWarning: true };
}

// ── Trial Reminder Check ──
function checkTrialReminder(state) {
  if (!state.trialEnd || state.status !== 'trialing') return;
  
  const trialEnd = new Date(state.trialEnd);
  const now = new Date();
  const daysUntilEnd = (trialEnd - now) / (24 * 60 * 60 * 1000);
  
  if (daysUntilEnd <= 3 && daysUntilEnd > 0 && !state.reminderDue) {
    state.reminderDue = true;
    state.reminderDueAt = new Date().toISOString();
    console.log(`[BILLING] 📧 Trial reminder due: lead=${state.leadId} days_left=${daysUntilEnd.toFixed(1)}`);
  }
}

// ── Access Gating ──
/**
 * Determines access level for a lead based on billing state.
 * 
 * Returns: {
 *   access: 'full' | 'warning' | 'read_only' | 'preview',
 *   status: string,
 *   message: string | null,
 *   billingState: object | null,
 *   gracePeriodEnd: string | null
 * }
 */
function getAccessLevel(leadId) {
  const state = readBillingState(leadId);
  
  if (!state) {
    return {
      access: 'preview',
      status: 'no_subscription',
      message: null,
      billingState: null,
      gracePeriodEnd: null
    };
  }

  switch (state.status) {
    case 'trialing':
      return {
        access: 'full',
        status: 'trialing',
        message: null,
        billingState: sanitizeBillingState(state),
        gracePeriodEnd: null
      };

    case 'active':
      return {
        access: 'full',
        status: 'active',
        message: null,
        billingState: sanitizeBillingState(state),
        gracePeriodEnd: null
      };

    case 'past_due': {
      // 7-day grace period from first payment failure
      const failedAt = state.lastPaymentFailedAt ? new Date(state.lastPaymentFailedAt) : new Date();
      const gracePeriodEnd = new Date(failedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      const now = new Date();
      
      if (now < gracePeriodEnd) {
        const daysLeft = Math.ceil((gracePeriodEnd - now) / (24 * 60 * 60 * 1000));
        return {
          access: 'warning',
          status: 'past_due',
          message: `Je betaling is niet gelukt. Je hebt nog ${daysLeft} dag${daysLeft !== 1 ? 'en' : ''} om dit op te lossen voordat je workspace read-only wordt.`,
          billingState: sanitizeBillingState(state),
          gracePeriodEnd: gracePeriodEnd.toISOString()
        };
      } else {
        return {
          access: 'read_only',
          status: 'past_due_expired',
          message: 'Je grace period is verlopen. Je workspace is nu read-only. Update je betaalgegevens om weer volledige toegang te krijgen.',
          billingState: sanitizeBillingState(state),
          gracePeriodEnd: gracePeriodEnd.toISOString()
        };
      }
    }

    case 'canceled':
      return {
        access: 'read_only',
        status: 'canceled',
        message: 'Je abonnement is geannuleerd. Je workspace is read-only. Upgrade om weer volledige toegang te krijgen.',
        billingState: sanitizeBillingState(state),
        gracePeriodEnd: null
      };

    default:
      return {
        access: 'preview',
        status: state.status || 'unknown',
        message: null,
        billingState: sanitizeBillingState(state),
        gracePeriodEnd: null
      };
  }
}

function sanitizeBillingState(state) {
  if (!state) return null;
  return {
    leadId: state.leadId,
    plan: state.plan,
    status: state.status,
    currentPeriodEnd: state.currentPeriodEnd || null,
    trialEnd: state.trialEnd || null,
    reminderDue: state.reminderDue || false,
    canceledAt: state.canceledAt || null,
    lastPaymentAt: state.lastPaymentAt || null,
    lastPaymentFailedAt: state.lastPaymentFailedAt || null,
    paymentFailureCount: state.paymentFailureCount || 0,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt
  };
}

// ── Billing-Triggered Email System ──
/**
 * Triggers lifecycle emails based on billing events.
 * Types: trial_ending, payment_failed, subscription_canceled, month2_welcome, payment_recovered
 */
function triggerBillingEmail(leadId, emailType) {
  if (!_dripEngine) {
    console.warn(`[BILLING] No drip engine linked — skipping ${emailType} email for lead=${leadId}`);
    return;
  }

  const state = readBillingState(leadId);
  if (!state) return;

  const planKey = state.plan || 'team';
  const planLabel = { solo: 'Solo', pro: 'Pro', team: 'Team', ops: 'Ops' }[planKey] || 'Team';
  const price = { solo: 49, pro: 149, team: 349, ops: 749 }[planKey] || 349;

  // Build email content based on type
  let subject, bodyHtml;

  switch (emailType) {
    case 'trial_ending':
      // Day-27 reminder — try drip engine first
      try {
        const dripStatus = _dripEngine.getDripStatus(leadId);
        if (dripStatus) {
          const day27 = dripStatus.schedule.find(s => s.day === 27);
          if (day27 && !day27.sent) {
            _dripEngine.sendDripEmail(leadId, 27).catch(err =>
              console.error(`[BILLING] Failed to send day-27 drip for ${leadId}:`, err.message)
            );
            return;
          }
        }
      } catch { /* fall through to direct send */ }

      subject = `Je SortBox ${planLabel} trial eindigt over 3 dagen`;
      bodyHtml = buildTrialEndingEmail(state, planLabel, price);
      break;

    case 'payment_failed':
      subject = `⚠️ Betaling niet gelukt — SortBox ${planLabel}`;
      bodyHtml = buildPaymentFailedEmail(state, planLabel, price);
      break;

    case 'subscription_canceled':
      subject = `Je SortBox ${planLabel} is stopgezet`;
      bodyHtml = buildSubscriptionCanceledEmail(state, planLabel);
      break;

    case 'month2_welcome':
      subject = `Welkom bij maand 2 van SortBox ${planLabel} 🎉`;
      bodyHtml = buildMonth2WelcomeEmail(state, planLabel, price);
      break;

    case 'payment_recovered':
      subject = `✅ Betaling gelukt — SortBox ${planLabel} hersteld`;
      bodyHtml = buildPaymentRecoveredEmail(state, planLabel);
      break;

    default:
      console.warn(`[BILLING] Unknown email type: ${emailType}`);
      return;
  }

  // Queue the email via drip engine's sendEmail
  const emailOpts = {
    from: 'Emily <emily@praesidion.com>',
    to: state.customerEmail,
    subject,
    html: wrapBillingEmailTemplate(bodyHtml, planLabel)
  };

  // Fire-and-forget with logging
  sendBillingEmail(leadId, emailType, emailOpts).catch(err =>
    console.error(`[BILLING] Failed to send ${emailType} email for ${leadId}:`, err.message)
  );
}

async function sendBillingEmail(leadId, emailType, emailOpts) {
  if (!emailOpts.to) {
    console.warn(`[BILLING] No email address for lead=${leadId}, skipping ${emailType}`);
    return;
  }

  const nodemailer = require('nodemailer');
  let result;

  // Try Resend first
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: emailOpts.from, to: [emailOpts.to], subject: emailOpts.subject, html: emailOpts.html })
      });
      const data = await resp.json();
      if (resp.ok) {
        result = { messageId: data.id, provider: 'resend' };
      } else {
        throw new Error(`Resend ${resp.status}: ${JSON.stringify(data)}`);
      }
    } catch (err) {
      console.error(`[BILLING] Resend failed for ${emailType}:`, err.message);
    }
  }

  // Fallback to Strato
  if (!result) {
    const stratoUser = process.env.STRATO_USER;
    const stratoPass = process.env.STRATO_PASS;
    if (stratoUser && stratoPass) {
      const transporter = nodemailer.createTransport({
        host: 'smtp.strato.de', port: 465, secure: true,
        auth: { user: stratoUser, pass: stratoPass }
      });
      const info = await transporter.sendMail(emailOpts);
      result = { messageId: info.messageId, provider: 'strato' };
    }
  }

  if (!result) {
    throw new Error('No email provider configured');
  }

  // Log to billing events
  logBillingEvent({
    type: `billing_email.${emailType}`,
    status: 'sent',
    leadId,
    messageId: result.messageId,
    provider: result.provider,
    to: emailOpts.to
  });

  console.log(`[BILLING] 📧 Sent ${emailType} email to ${emailOpts.to} (${result.provider}, id=${result.messageId})`);
  return result;
}

// ── Billing Email Templates ──

function buildTrialEndingEmail(state, planLabel, price) {
  const endDate = state.trialEnd ? new Date(state.trialEnd).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }) : 'binnenkort';
  return `
    <h2 style="color:#1e3a5f;margin:0 0 16px 0;font-size:22px;">Je gratis maand loopt bijna af</h2>
    <p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 16px 0;">
      Over 3 dagen eindigt je gratis ${planLabel}-periode. Dit is wat er daarna gebeurt:
    </p>
    <div style="background:#f0f7ff;border-radius:8px;padding:20px;margin:20px 0;">
      <ul style="margin:0;padding:0 0 0 20px;color:#374151;line-height:2;">
        <li><strong>Niets doen = doorgaan.</strong> Je plan wordt voortgezet voor €${price}/maand.</li>
        <li><strong>Opzeggen?</strong> Reply op deze mail of mail emily@praesidion.com. Geen opzegtermijn.</li>
        <li>Eerste facturatie: ${endDate}.</li>
      </ul>
    </div>
    <p style="color:#6b7280;font-size:14px;line-height:1.5;">
      Als SortBox je rust, snelheid of grip oplevert — hoef je niets te veranderen.
    </p>
  `;
}

function buildPaymentFailedEmail(state, planLabel, price) {
  const failCount = state.paymentFailureCount || 1;
  return `
    <h2 style="color:#dc2626;margin:0 0 16px 0;font-size:22px;">⚠️ Betaling niet gelukt</h2>
    <p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 16px 0;">
      We konden je betaling van €${price} voor SortBox ${planLabel} niet verwerken${failCount > 1 ? ` (poging ${failCount})` : ''}.
    </p>
    <div style="background:#fef2f2;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="color:#991b1b;font-weight:600;margin:0 0 8px 0;">Wat nu?</p>
      <ul style="margin:0;padding:0 0 0 20px;color:#374151;line-height:2;">
        <li>Je workspace blijft nog <strong>7 dagen</strong> volledig beschikbaar (grace period).</li>
        <li>Check of je kaartgegevens kloppen in je Stripe dashboard.</li>
        <li>We proberen het automatisch opnieuw over 3 dagen.</li>
      </ul>
    </div>
    <div style="text-align:center;margin:24px 0;">
      <a href="https://billing.stripe.com/p/login/test" style="background:#1e3a5f;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
        Betaalgegevens bijwerken →
      </a>
    </div>
    <p style="color:#6b7280;font-size:14px;line-height:1.5;">
      Vragen? Reply op deze mail of bel 046 240 2401.
    </p>
  `;
}

function buildSubscriptionCanceledEmail(state, planLabel) {
  return `
    <h2 style="color:#1e3a5f;margin:0 0 16px 0;font-size:22px;">Je SortBox ${planLabel} is stopgezet</h2>
    <p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 16px 0;">
      Je abonnement is beëindigd. Dit is er veranderd:
    </p>
    <div style="background:#f9fafb;border-radius:8px;padding:20px;margin:20px 0;">
      <ul style="margin:0;padding:0 0 0 20px;color:#374151;line-height:2;">
        <li>Je workspace is nu <strong>read-only</strong> — je data blijft beschikbaar.</li>
        <li>Prioriteiten, samenvattingen en concepten worden niet meer bijgewerkt.</li>
        <li>Je kunt op elk moment je plan opnieuw activeren.</li>
      </ul>
    </div>
    <p style="color:#374151;font-size:16px;line-height:1.6;">
      We bewaren je data en instellingen nog 90 dagen. Wil je opnieuw starten? 
      Reply op deze mail en we zetten alles weer aan.
    </p>
    <p style="color:#6b7280;font-size:14px;line-height:1.5;">
      Bedankt dat je SortBox hebt geprobeerd. We hopen je in de toekomst weer te zien.
    </p>
  `;
}

function buildMonth2WelcomeEmail(state, planLabel, price) {
  return `
    <h2 style="color:#1e3a5f;margin:0 0 16px 0;font-size:22px;">Welkom bij maand 2 🎉</h2>
    <p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 16px 0;">
      Je eerste betaling van €${price} is verwerkt. Bedankt voor het vertrouwen!
    </p>
    <div style="background:#ecfdf5;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="color:#065f46;font-weight:600;margin:0 0 8px 0;">Wat is er nieuw deze maand:</p>
      <ul style="margin:0;padding:0 0 0 20px;color:#374151;line-height:2;">
        <li>SortBox kent je mailpatronen nu beter — verwacht scherpere prioriteiten.</li>
        <li>Conceptantwoorden worden steeds beter afgestemd op je tone of voice.</li>
        <li>Je kunt altijd je instellingen verfijnen via het dashboard.</li>
      </ul>
    </div>
    <p style="color:#6b7280;font-size:14px;line-height:1.5;">
      Vragen of feedback? Reply op deze mail. We staan klaar.
    </p>
  `;
}

function buildPaymentRecoveredEmail(state, planLabel) {
  return `
    <h2 style="color:#065f46;margin:0 0 16px 0;font-size:22px;">✅ Betaling gelukt</h2>
    <p style="color:#374151;font-size:16px;line-height:1.6;margin:0 0 16px 0;">
      Je betaling is succesvol verwerkt. Je SortBox ${planLabel}-workspace is weer volledig actief.
    </p>
    <div style="background:#ecfdf5;border-radius:8px;padding:20px;margin:20px 0;">
      <ul style="margin:0;padding:0 0 0 20px;color:#374151;line-height:2;">
        <li>Alle functies zijn hersteld.</li>
        <li>Je prioriteiten en concepten worden weer bijgewerkt.</li>
        <li>Geen verdere actie nodig.</li>
      </ul>
    </div>
  `;
}

function wrapBillingEmailTemplate(bodyContent, planLabel) {
  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:#1e3a5f;border-radius:8px 8px 0 0;padding:24px 32px;text-align:center;">
      <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;">📬 SortBox</h1>
      <p style="color:#93c5fd;margin:6px 0 0 0;font-size:13px;">${planLabel} Plan</p>
    </div>
    <div style="background:#ffffff;padding:32px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
      ${bodyContent}
    </div>
    <div style="background:#f9fafb;border-radius:0 0 8px 8px;padding:20px 32px;border:1px solid #e5e7eb;border-top:none;">
      <p style="color:#9ca3af;font-size:12px;margin:0;line-height:1.5;text-align:center;">
        SortBox by Praesidion Security B.V.<br>
        <a href="mailto:emily@praesidion.com" style="color:#6b7280;">emily@praesidion.com</a> · 
        <a href="tel:0462402401" style="color:#6b7280;">046 240 2401</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ── Main Webhook Handler ──
function processWebhookEvent(eventType, eventData) {
  let result;
  switch (eventType) {
    case 'checkout.session.completed':
      result = handleCheckoutCompleted(eventData);
      break;
    case 'customer.subscription.updated':
      result = handleSubscriptionUpdated(eventData);
      // If subscription moved from trialing → active, trigger month-2 welcome
      if (result.ok && result.status === 'active' && eventData.status === 'active') {
        const prevState = findLeadBySubscriptionId(eventData.id) || findLeadByStripeCustomer(eventData.customer);
        // Check if this is the first time moving to active (had a trial before)
        if (prevState && prevState.trialEnd) {
          const events = prevState.events || [];
          const alreadySentMonth2 = events.some(e => e.type === 'billing_email.month2_welcome');
          if (!alreadySentMonth2) {
            triggerBillingEmail(result.leadId, 'month2_welcome');
          }
        }
      }
      break;
    case 'customer.subscription.deleted':
      result = handleSubscriptionDeleted(eventData);
      if (result.ok) {
        triggerBillingEmail(result.leadId, 'subscription_canceled');
      }
      break;
    case 'customer.subscription.trial_will_end':
      result = handleTrialWillEnd(eventData);
      break;
    case 'invoice.paid':
      result = handleInvoicePaid(eventData);
      // If payment was recovered from past_due, send recovery email
      if (result.ok && result.wasRecovery) {
        triggerBillingEmail(result.leadId, 'payment_recovered');
      }
      break;
    case 'invoice.payment_failed':
      result = handleInvoicePaymentFailed(eventData);
      if (result.ok) {
        triggerBillingEmail(result.leadId, 'payment_failed');
      }
      break;
    default:
      console.log(`[BILLING] Unhandled event type: ${eventType}`);
      logBillingEvent({ type: eventType, status: 'unhandled' });
      return { ok: true, handled: false, reason: 'unhandled_event_type' };
  }
  return result;
}

// ── Scan all billing states for trial reminders ──
function scanTrialReminders() {
  ensureBillingDir();
  const updated = [];
  try {
    const files = fs.readdirSync(BILLING_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const state = JSON.parse(fs.readFileSync(path.join(BILLING_DIR, file), 'utf8'));
        if (state.status === 'trialing' && !state.reminderDue) {
          const before = state.reminderDue;
          checkTrialReminder(state);
          if (state.reminderDue !== before) {
            writeBillingState(state.leadId, state);
            updated.push(state.leadId);
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* dir doesn't exist */ }
  return updated;
}

module.exports = {
  verifyStripeSignature,
  processWebhookEvent,
  getAccessLevel,
  readBillingState,
  writeBillingState,
  findLeadByStripeCustomer,
  findLeadBySubscriptionId,
  scanTrialReminders,
  sanitizeBillingState,
  logBillingEvent,
  triggerBillingEmail,
  setBillingDripEngine,
  PLAN_PRICES
};
