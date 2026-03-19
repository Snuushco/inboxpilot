/**
 * InboxPilot Serverless Store
 * Uses /tmp/ for ephemeral state in Vercel serverless functions.
 * Known limitation: data lost on cold start. Production: use Vercel KV or Upstash Redis.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join('/tmp', 'inboxpilot');
const EVENTS_JSONL = path.join(DATA_DIR, 'submissions.jsonl');
const LEADS_INDEX_JSON = path.join(DATA_DIR, 'leads-index.json');
const STATUS_JSON = path.join(DATA_DIR, 'status.json');
const LATEST_JSON = path.join(DATA_DIR, 'latest-submission.json');
const DAILY_DIR = path.join(DATA_DIR, 'daily');
const TRIAGE_DIR = path.join(DATA_DIR, 'triage-actions');
const BILLING_DIR = path.join(DATA_DIR, 'billing');
const DRIP_DIR = path.join(DATA_DIR, 'drip');
const EMAIL_LOG = path.join(DATA_DIR, 'email-log.jsonl');
const BILLING_LOG = path.join(DATA_DIR, 'billing-events.jsonl');

const CHECKOUT_LINKS = {
  solo: 'https://buy.stripe.com/dRm00i5QjaYBca1bYq3ZK0a',
  pro: 'https://buy.stripe.com/eVq8wOa6z4Ad7TL4vY3ZK0b',
  team: 'https://buy.stripe.com/aFacN43Ib5Eh5LD3rU3ZK0c',
  ops: 'https://buy.stripe.com/eVq00i0vZ8Qt0rj2nQ3ZK0d'
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

function ensureJsonFile(filePath, data) {
  ensureDir(path.dirname(filePath));
  if (!fs.existsSync(filePath)) {
    writeJsonAtomic(filePath, data);
  }
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function appendJsonLine(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

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

function initStore() {
  ensureDir(DATA_DIR);
  ensureDir(DAILY_DIR);
  ensureDir(TRIAGE_DIR);
  ensureDir(BILLING_DIR);
  ensureDir(DRIP_DIR);
  ensureFile(EVENTS_JSONL, '');
  ensureJsonFile(LEADS_INDEX_JSON, { generatedAt: null, leadCount: 0, leads: {} });
  ensureJsonFile(STATUS_JSON, buildBaseStatus());
  ensureJsonFile(LATEST_JSON, { ok: true, latest: null });
}

function buildBaseStatus() {
  return {
    ok: true,
    service: 'inboxpilot',
    startedAt: new Date().toISOString(),
    eventsPath: EVENTS_JSONL,
    emailEnabled: true,
    counts: { totalEvents: 0, uniqueLeads: 0, duplicates: 0 },
    latestLead: null
  };
}

function countJsonLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) return 0;
    return content.split(/\n+/).filter(Boolean).length;
  } catch {
    return 0;
  }
}

function totalDuplicateEvents() {
  try {
    const content = fs.readFileSync(EVENTS_JSONL, 'utf8').trim();
    if (!content) return 0;
    return content.split(/\n+/).filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean)
      .filter(item => item.duplicate).length;
  } catch {
    return 0;
  }
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
  initStore();
  const index = readJson(LEADS_INDEX_JSON, { generatedAt: null, leadCount: 0, leads: {} });
  const existing = index.leads[payload.fingerprint] || null;
  if (existing) {
    payload.duplicate = true;
    payload.duplicateOf = existing.leadId;
  }

  appendJsonLine(EVENTS_JSONL, payload);

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
  writeJsonAtomic(LEADS_INDEX_JSON, index);
  writeJsonAtomic(LATEST_JSON, { ok: true, latest: payload });

  const dayKey = payload.submittedAt.slice(0, 10);
  const dailyPath = path.join(DAILY_DIR, `${dayKey}.json`);
  const daily = readJson(dailyPath, {
    date: dayKey, generatedAt: null, totalEvents: 0,
    uniqueLeadFingerprints: [], duplicateEvents: 0, leads: []
  });
  daily.generatedAt = new Date().toISOString();
  daily.totalEvents += 1;
  if (payload.duplicate) daily.duplicateEvents += 1;
  if (!daily.uniqueLeadFingerprints.includes(payload.fingerprint)) daily.uniqueLeadFingerprints.push(payload.fingerprint);
  daily.leads.push({
    submittedAt: payload.submittedAt, leadId: payload.leadId,
    emailMasked: maskEmail(payload.email), company: payload.company,
    planKey: payload.planKey, checkout: payload.checkout,
    duplicate: payload.duplicate, duplicateOf: payload.duplicateOf
  });
  writeJsonAtomic(dailyPath, daily);

  const totalEvents = countJsonLines(EVENTS_JSONL);
  const duplicates = totalDuplicateEvents();
  const status = readJson(STATUS_JSON, buildBaseStatus());
  status.ok = true;
  status.generatedAt = new Date().toISOString();
  status.counts = { totalEvents, uniqueLeads: index.leadCount, duplicates };
  status.latestLead = payload;
  writeJsonAtomic(STATUS_JSON, status);

  return { index, dailyPath, status, existingLeadId: existing ? existing.leadId : null };
}

function findLeadById(leadId) {
  if (!leadId) return null;
  initStore();
  const latest = readJson(LATEST_JSON, { ok: true, latest: null }).latest;
  if (latest && (latest.leadId === leadId || latest.duplicateOf === leadId)) return latest;
  const index = readJson(LEADS_INDEX_JSON, { generatedAt: null, leadCount: 0, leads: {} });
  const match = Object.values(index.leads || {}).find(item => item.leadId === leadId || item.lastEventLeadId === leadId);
  if (!match) return null;
  return {
    leadId: match.lastEventLeadId || match.leadId,
    canonicalLeadId: match.leadId,
    submittedAt: match.latestSubmissionAt,
    firstName: match.firstName, lastName: match.lastName,
    email: match.email, company: match.company,
    userType: match.userType, mailboxes: match.mailboxes,
    mailTypes: match.mailTypes, actions: match.actions,
    tone: match.tone, plan: match.plan, planKey: match.planKey,
    checkout: match.checkout, fingerprint: match.fingerprint,
    source: match.source, duplicate: false, duplicateOf: null
  };
}

function getLatestLead() {
  initStore();
  return readJson(LATEST_JSON, { ok: true, latest: null }).latest || null;
}

function summarizeStatusForResponse(status) {
  return {
    ok: Boolean(status && status.ok),
    service: status?.service || 'inboxpilot',
    startedAt: status?.startedAt || null,
    generatedAt: status?.generatedAt || null,
    emailEnabled: Boolean(status?.emailEnabled),
    counts: status?.counts || { totalEvents: 0, uniqueLeads: 0, duplicates: 0 },
    latestLead: redactLead(status?.latestLead || null)
  };
}

module.exports = {
  DATA_DIR, EVENTS_JSONL, LEADS_INDEX_JSON, STATUS_JSON, LATEST_JSON,
  DAILY_DIR, TRIAGE_DIR, BILLING_DIR, DRIP_DIR, EMAIL_LOG, BILLING_LOG,
  CHECKOUT_LINKS,
  initStore, ensureDir, ensureFile, ensureJsonFile,
  writeJsonAtomic, readJson, appendJsonLine,
  sha1, normalizeText, normalizePlan, validEmail, maskEmail, redactLead,
  buildBaseStatus, countJsonLines, totalDuplicateEvents,
  buildLeadPayload, validateLeadPayload, upsertLeadFiles,
  findLeadById, getLatestLead, summarizeStatusForResponse
};
