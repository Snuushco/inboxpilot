/**
 * InboxPilot Billing Module (Serverless)
 * Stripe webhook handling, subscription state, access gating.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');

const PLAN_PRICES = { solo: 4900, pro: 14900, team: 34900, ops: 74900 };

function billingPath(leadId) {
  if (!leadId || typeof leadId !== 'string') return null;
  const safe = leadId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(store.BILLING_DIR, `${safe}.json`);
}

function readBillingState(leadId) {
  const fp = billingPath(leadId);
  if (!fp) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

function writeBillingState(leadId, state) {
  store.ensureDir(store.BILLING_DIR);
  const fp = billingPath(leadId);
  if (!fp) return false;
  store.writeJsonAtomic(fp, state);
  return true;
}

function findLeadByStripeCustomer(customerId) {
  store.ensureDir(store.BILLING_DIR);
  try {
    const files = fs.readdirSync(store.BILLING_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(store.BILLING_DIR, file), 'utf8'));
        if (data.stripeCustomerId === customerId) return data;
      } catch {}
    }
  } catch {}
  return null;
}

function findLeadBySubscriptionId(subscriptionId) {
  store.ensureDir(store.BILLING_DIR);
  try {
    const files = fs.readdirSync(store.BILLING_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(store.BILLING_DIR, file), 'utf8'));
        if (data.subscriptionId === subscriptionId) return data;
      } catch {}
    }
  } catch {}
  return null;
}

function logBillingEvent(event) {
  store.appendJsonLine(store.BILLING_LOG, { ...event, processedAt: new Date().toISOString() });
}

function verifyStripeSignature(payload, sigHeader, secret) {
  if (!secret) return { verified: false, reason: 'no_secret_configured' };
  if (!sigHeader) return { verified: false, reason: 'no_signature_header', reject: true };
  try {
    const elements = sigHeader.split(',');
    const tsElement = elements.find(e => e.startsWith('t='));
    const sigElements = elements.filter(e => e.startsWith('v1='));
    if (!tsElement || sigElements.length === 0) return { verified: false, reason: 'malformed_signature', reject: true };
    const timestamp = tsElement.slice(2);
    const expectedSigs = sigElements.map(e => e.slice(3));
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) return { verified: false, reason: 'timestamp_too_old', reject: true };
    const signedPayload = `${timestamp}.${payload}`;
    const expectedSig = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
    const match = expectedSigs.some(sig => crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig)));
    if (!match) return { verified: false, reason: 'signature_mismatch', reject: true };
    return { verified: true };
  } catch (err) {
    return { verified: false, reason: `verification_error: ${err.message}`, reject: true };
  }
}

function resolvePlanFromAmount(amountInCents) {
  for (const [plan, price] of Object.entries(PLAN_PRICES)) {
    if (price === amountInCents) return plan;
  }
  return null;
}

function getAccessLevel(leadId) {
  const state = readBillingState(leadId);
  if (!state) return { access: 'preview', status: 'no_subscription', message: null, billingState: null, gracePeriodEnd: null };

  const sanitized = {
    leadId: state.leadId, plan: state.plan, status: state.status,
    currentPeriodEnd: state.currentPeriodEnd || null, trialEnd: state.trialEnd || null,
    reminderDue: state.reminderDue || false, canceledAt: state.canceledAt || null,
    lastPaymentAt: state.lastPaymentAt || null, createdAt: state.createdAt, updatedAt: state.updatedAt
  };

  switch (state.status) {
    case 'trialing': return { access: 'full', status: 'trialing', message: null, billingState: sanitized, gracePeriodEnd: null };
    case 'active': return { access: 'full', status: 'active', message: null, billingState: sanitized, gracePeriodEnd: null };
    case 'past_due': {
      const failedAt = state.lastPaymentFailedAt ? new Date(state.lastPaymentFailedAt) : new Date();
      const gracePeriodEnd = new Date(failedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      const now = new Date();
      if (now < gracePeriodEnd) {
        const daysLeft = Math.ceil((gracePeriodEnd - now) / (24 * 60 * 60 * 1000));
        return { access: 'warning', status: 'past_due', message: `Je betaling is niet gelukt. Je hebt nog ${daysLeft} dag${daysLeft !== 1 ? 'en' : ''} om dit op te lossen.`, billingState: sanitized, gracePeriodEnd: gracePeriodEnd.toISOString() };
      }
      return { access: 'read_only', status: 'past_due_expired', message: 'Grace period verlopen. Workspace is read-only.', billingState: sanitized, gracePeriodEnd: gracePeriodEnd.toISOString() };
    }
    case 'canceled': return { access: 'read_only', status: 'canceled', message: 'Abonnement geannuleerd. Workspace is read-only.', billingState: sanitized, gracePeriodEnd: null };
    default: return { access: 'preview', status: state.status || 'unknown', message: null, billingState: sanitized, gracePeriodEnd: null };
  }
}

function processWebhookEvent(eventType, eventData) {
  store.initStore();
  logBillingEvent({ type: eventType, status: 'received' });

  if (eventType === 'checkout.session.completed') {
    const leadId = eventData.client_reference_id || eventData.metadata?.leadId;
    if (!leadId) return { ok: false, reason: 'no_leadId' };
    const billingState = {
      leadId, stripeCustomerId: eventData.customer, subscriptionId: eventData.subscription,
      customerEmail: eventData.customer_email || eventData.customer_details?.email || null,
      plan: eventData.metadata?.plan || 'unknown', status: 'trialing',
      trialEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      reminderDue: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      events: [{ type: eventType, at: new Date().toISOString() }]
    };
    writeBillingState(leadId, billingState);
    return { ok: true, leadId, status: 'trialing' };
  }

  if (eventType === 'invoice.paid') {
    const state = findLeadBySubscriptionId(eventData.subscription) || findLeadByStripeCustomer(eventData.customer);
    if (!state) return { ok: false, reason: 'unknown_customer' };
    if (state.status !== 'trialing') state.status = 'active';
    state.lastPaymentAt = new Date().toISOString();
    state.updatedAt = new Date().toISOString();
    writeBillingState(state.leadId, state);
    return { ok: true, leadId: state.leadId, status: state.status };
  }

  if (eventType === 'invoice.payment_failed') {
    const state = findLeadBySubscriptionId(eventData.subscription) || findLeadByStripeCustomer(eventData.customer);
    if (!state) return { ok: false, reason: 'unknown_customer' };
    state.status = 'past_due';
    state.lastPaymentFailedAt = new Date().toISOString();
    state.paymentFailureCount = (state.paymentFailureCount || 0) + 1;
    state.updatedAt = new Date().toISOString();
    writeBillingState(state.leadId, state);
    return { ok: true, leadId: state.leadId, status: 'past_due' };
  }

  if (eventType === 'customer.subscription.deleted') {
    const state = findLeadBySubscriptionId(eventData.id) || findLeadByStripeCustomer(eventData.customer);
    if (!state) return { ok: false, reason: 'unknown_customer' };
    state.status = 'canceled';
    state.canceledAt = new Date().toISOString();
    state.updatedAt = new Date().toISOString();
    writeBillingState(state.leadId, state);
    return { ok: true, leadId: state.leadId, status: 'canceled' };
  }

  return { ok: true, handled: false, reason: 'unhandled_event_type' };
}

function scanTrialReminders() {
  store.ensureDir(store.BILLING_DIR);
  const updated = [];
  try {
    const files = fs.readdirSync(store.BILLING_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const state = JSON.parse(fs.readFileSync(path.join(store.BILLING_DIR, file), 'utf8'));
        if (state.status === 'trialing' && !state.reminderDue && state.trialEnd) {
          const daysUntilEnd = (new Date(state.trialEnd) - new Date()) / (24 * 60 * 60 * 1000);
          if (daysUntilEnd <= 3 && daysUntilEnd > 0) {
            state.reminderDue = true;
            state.reminderDueAt = new Date().toISOString();
            writeBillingState(state.leadId, state);
            updated.push(state.leadId);
          }
        }
      } catch {}
    }
  } catch {}
  return updated;
}

module.exports = {
  verifyStripeSignature, processWebhookEvent, getAccessLevel,
  readBillingState, writeBillingState, scanTrialReminders,
  logBillingEvent, PLAN_PRICES
};
