/**
 * Shared helpers for InboxPilot API routes
 */
const crypto = require('crypto');
const path = require('path');
const storage = require('./storage');

const CHECKOUT_LINKS = {
  solo: 'https://buy.stripe.com/dRm00i5QjaYBca1bYq3ZK0a',
  pro: 'https://buy.stripe.com/eVq8wOa6z4Ad7TL4vY3ZK0b',
  team: 'https://buy.stripe.com/aFacN43Ib5Eh5LD3rU3ZK0c',
  ops: 'https://buy.stripe.com/eVq00i0vZ8Qt0rj2nQ3ZK0d'
};

function normalizeText(value, max = 4000) {
  return String(value || '').replace(/\r/g, '').trim().slice(0, max);
}

function normalizePlan(plan) {
  const value = normalizeText(plan, 200).toLowerCase();
  if (value.includes('solo')) return 'solo';
  if (value.includes('pro')) return 'pro';
  if (value.includes('team')) return 'team';
  if (value.includes('ops')) return 'ops';
  if (value.includes('enterprise')) return 'enterprise';
  return null;
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function maskEmail(email) {
  const value = normalizeText(email, 320).toLowerCase();
  if (!value || !value.includes('@')) return '(redacted)';
  const [local, domain] = value.split('@');
  const safeLocal = local.length <= 2 ? `${local.slice(0, 1)}***` : `${local.slice(0, 2)}***${local.slice(-1)}`;
  const domainParts = domain.split('.').filter(Boolean);
  if (!domainParts.length) return `${safeLocal}@***`;
  const root = domainParts[0];
  const maskedRoot = root.length <= 2 ? `${root.slice(0, 1)}***` : `${root.slice(0, 2)}***${root.slice(-1)}`;
  const suffix = domainParts.slice(1).join('.');
  return suffix ? `${safeLocal}@${maskedRoot}.${suffix}` : `${safeLocal}@${maskedRoot}`;
}

function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function redactLead(lead) {
  if (!lead) return null;
  return {
    leadId: lead.leadId || null,
    canonicalLeadId: lead.duplicateOf || lead.canonicalLeadId || lead.leadId || null,
    submittedAt: lead.submittedAt || lead.latestSubmissionAt || null,
    emailMasked: maskEmail(lead.email),
    planKey: lead.planKey || normalizePlan(lead.plan || ''),
    duplicate: Boolean(lead.duplicate),
    duplicateOf: lead.duplicateOf || null,
    source: lead.source || null,
    company: lead.company || null,
    firstName: lead.firstName || null,
    lastName: lead.lastName || null
  };
}

function sendJson(res, statusCode, data) {
  res.status(statusCode).json(data);
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, stripe-signature');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function handleCors(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

// ── Lead Storage ──

function getLeadsIndexPath() {
  return path.join(storage.getDataDir(), 'leads-index.json');
}

function getEventsPath() {
  return path.join(storage.getDataDir(), 'submissions.jsonl');
}

function getLatestPath() {
  return path.join(storage.getDataDir(), 'latest-submission.json');
}

function getStatusPath() {
  return path.join(storage.getDataDir(), 'status.json');
}

function buildLeadPayload(input) {
  const submittedAt = new Date().toISOString();
  const normalizedEmail = normalizeText(input.email, 320).toLowerCase();
  const plan = normalizeText(input.plan, 200);
  const planKey = normalizePlan(plan);
  const fingerprint = sha1([
    normalizedEmail,
    planKey || 'unknown',
    normalizeText(input.company, 200).toLowerCase(),
    normalizeText(input.userType, 50).toLowerCase(),
    normalizeText(input.mailboxes, 50).toLowerCase()
  ].join('|'));

  return {
    leadId: `ip_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    submittedAt,
    firstName: normalizeText(input.firstName, 120),
    lastName: normalizeText(input.lastName, 120),
    email: normalizedEmail,
    company: normalizeText(input.company, 200),
    userType: normalizeText(input.userType, 50),
    mailboxes: normalizeText(input.mailboxes, 50),
    mailTypes: normalizeText(input.mailTypes, 4000),
    actions: normalizeText(input.actions, 4000),
    tone: normalizeText(input.tone, 120),
    plan,
    planKey,
    flow: 'first-month-free',
    checkout: planKey && CHECKOUT_LINKS[planKey] ? CHECKOUT_LINKS[planKey] : null,
    fingerprint,
    source: 'landing-page',
    operatorNotes: '',
    duplicate: false,
    duplicateOf: null
  };
}

function validateLeadPayload(payload) {
  if (!payload.firstName || !payload.lastName || !payload.email || !payload.plan) return 'missing_required_fields';
  if (!validEmail(payload.email)) return 'invalid_email';
  return null;
}

function upsertLeadFiles(payload) {
  const indexPath = getLeadsIndexPath();
  const index = storage.readJson(indexPath, { generatedAt: null, leadCount: 0, leads: {} });
  const existing = index.leads[payload.fingerprint] || null;
  
  if (existing) {
    payload.duplicate = true;
    payload.duplicateOf = existing.leadId;
  }

  storage.appendLine(getEventsPath(), payload);

  const leadRecord = {
    leadId: existing ? existing.leadId : payload.leadId,
    firstSeenAt: existing ? existing.firstSeenAt : payload.submittedAt,
    latestSubmissionAt: payload.submittedAt,
    firstName: payload.firstName,
    lastName: payload.lastName,
    email: payload.email,
    company: payload.company,
    userType: payload.userType,
    mailboxes: payload.mailboxes,
    plan: payload.plan,
    planKey: payload.planKey,
    checkout: payload.checkout,
    tone: payload.tone,
    mailTypes: payload.mailTypes,
    actions: payload.actions,
    source: payload.source,
    duplicateCount: existing ? (existing.duplicateCount || 0) + 1 : 0,
    lastEventLeadId: payload.leadId,
    fingerprint: payload.fingerprint
  };

  index.generatedAt = new Date().toISOString();
  index.leads[payload.fingerprint] = leadRecord;
  index.leadCount = Object.keys(index.leads).length;
  storage.writeJson(indexPath, index);
  storage.writeJson(getLatestPath(), { ok: true, latest: payload });

  return { index, existingLeadId: existing ? existing.leadId : null };
}

function findLeadById(leadId) {
  if (!leadId) return null;
  const latest = storage.readJson(getLatestPath(), { ok: true, latest: null }).latest;
  if (latest && (latest.leadId === leadId || latest.duplicateOf === leadId)) return latest;

  const index = storage.readJson(getLeadsIndexPath(), { generatedAt: null, leadCount: 0, leads: {} });
  const match = Object.values(index.leads || {}).find(item => item.leadId === leadId || item.lastEventLeadId === leadId);
  if (!match) return null;
  return {
    leadId: match.lastEventLeadId || match.leadId,
    canonicalLeadId: match.leadId,
    submittedAt: match.latestSubmissionAt,
    firstName: match.firstName,
    lastName: match.lastName,
    email: match.email,
    company: match.company,
    userType: match.userType,
    mailboxes: match.mailboxes,
    mailTypes: match.mailTypes,
    actions: match.actions,
    tone: match.tone,
    plan: match.plan,
    planKey: match.planKey,
    checkout: match.checkout,
    fingerprint: match.fingerprint,
    source: match.source,
    duplicate: false,
    duplicateOf: null
  };
}

function getLatestLead() {
  return storage.readJson(getLatestPath(), { ok: true, latest: null }).latest || null;
}

module.exports = {
  CHECKOUT_LINKS,
  normalizeText,
  normalizePlan,
  validEmail,
  maskEmail,
  sha1,
  redactLead,
  sendJson,
  corsHeaders,
  handleCors,
  buildLeadPayload,
  validateLeadPayload,
  upsertLeadFiles,
  findLeadById,
  getLatestLead,
  getLeadsIndexPath,
  getEventsPath,
  getLatestPath,
  getStatusPath
};
