/**
 * SortBox IMAP Engine v2
 * 
 * Secure IMAP connection module with:
 * - AES-256-GCM encryption for credentials at rest (PBKDF2 key derivation)
 * - Connection validation with auto-detect for major providers
 * - Polling loop with exponential backoff on failures
 * - Message parsing, storage, and triage/summary pipeline hooks
 * - Auth provider abstraction (IMAP password now, OAuth/Graph later)
 * - Connection health monitoring and metrics
 * 
 * Dependencies: imapflow, mailparser
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'submissions');
const CRED_DIR = path.join(DATA_DIR, 'imap-credentials');
const INBOX_DIR = path.join(DATA_DIR, 'inbox');
const TRIAGE_DIR = path.join(DATA_DIR, 'triage');

// Ensure directories
[CRED_DIR, INBOX_DIR, TRIAGE_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── Constants ───────────────────────────────────────────────────────

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT = 'inboxpilot-v2-salt'; // Static salt, combined with key material
const POLL_INTERVAL_MS = 5 * 60 * 1000;        // 5 minutes default
const MAX_BACKOFF_MS = 60 * 60 * 1000;          // 1 hour max backoff
const MAX_CONSECUTIVE_FAILURES = 10;            // Pause auto-poll after this many failures
const MAX_MESSAGES_PER_POLL = 50;               // Cap fetched messages per cycle
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;       // 1 hour
const RATE_LIMIT_MAX = 5;
const CONNECTION_TIMEOUT = 15_000;              // 15s
const SOCKET_TIMEOUT = 30_000;                  // 30s

// ── Provider Detection ──────────────────────────────────────────────

const KNOWN_PROVIDERS = {
  gmail: {
    name: 'Gmail',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    domains: ['gmail.com', 'googlemail.com'],
    requiresAppPassword: true,
    oauthSupported: true,
    notes: 'Vereist een app-wachtwoord (2FA moet aan staan) of OAuth2.'
  },
  outlook: {
    name: 'Outlook / Microsoft 365',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'live.nl', 'msn.com'],
    requiresAppPassword: false,
    oauthSupported: true,
    notes: 'Microsoft Graph API beschikbaar als alternatief voor IMAP.'
  },
  yahoo: {
    name: 'Yahoo Mail',
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    domains: ['yahoo.com', 'yahoo.nl', 'yahoo.co.uk'],
    requiresAppPassword: true,
    oauthSupported: false,
    notes: 'Vereist een app-wachtwoord via Yahoo beveiligingsinstellingen.'
  },
  strato: {
    name: 'Strato',
    imapHost: 'imap.strato.de',
    imapPort: 993,
    domains: [],
    requiresAppPassword: false,
    oauthSupported: false,
    notes: 'Standaard IMAP, geen app-wachtwoord nodig.'
  },
  ziggo: {
    name: 'Ziggo',
    imapHost: 'imap.ziggo.nl',
    imapPort: 993,
    domains: ['ziggo.nl'],
    requiresAppPassword: false,
    oauthSupported: false,
    notes: 'Standaard IMAP met SSL.'
  },
  kpn: {
    name: 'KPN / XS4ALL / Planet',
    imapHost: 'imap.kpnmail.nl',
    imapPort: 993,
    domains: ['kpnmail.nl', 'xs4all.nl', 'planet.nl', 'hetnet.nl'],
    requiresAppPassword: false,
    oauthSupported: false,
    notes: 'Standaard IMAP met SSL.'
  }
};

function detectProvider(email) {
  if (!email || !email.includes('@')) return null;
  const domain = email.split('@')[1].toLowerCase();

  for (const [key, provider] of Object.entries(KNOWN_PROVIDERS)) {
    if (provider.domains.includes(domain)) {
      return { key, ...provider };
    }
  }

  // Try to guess from MX-like patterns
  if (domain.includes('google') || domain.includes('gmail')) return { key: 'gmail', ...KNOWN_PROVIDERS.gmail };
  if (domain.includes('microsoft') || domain.includes('office365')) return { key: 'outlook', ...KNOWN_PROVIDERS.outlook };

  return null;
}

function suggestImapSettings(email) {
  const provider = detectProvider(email);
  if (provider) {
    return {
      detected: true,
      provider: provider.name,
      host: provider.imapHost,
      port: provider.imapPort,
      requiresAppPassword: provider.requiresAppPassword,
      oauthSupported: provider.oauthSupported,
      notes: provider.notes
    };
  }

  // Fallback: guess from domain
  const domain = email.split('@')[1];
  return {
    detected: false,
    provider: null,
    host: `imap.${domain}`,
    port: 993,
    requiresAppPassword: false,
    oauthSupported: false,
    notes: `Geen bekende provider gevonden. Probeer imap.${domain}:993 met SSL.`
  };
}

// ── Encryption helpers (PBKDF2 + AES-256-GCM) ──────────────────────

function getEncryptionKey() {
  const keyMaterial = process.env.IMAP_ENCRYPTION_KEY;
  if (!keyMaterial) throw new Error('IMAP_ENCRYPTION_KEY environment variable not set');
  // PBKDF2 for proper key derivation (100k iterations)
  return crypto.pbkdf2Sync(keyMaterial, PBKDF2_SALT, PBKDF2_ITERATIONS, 32, 'sha512');
}

function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return { iv: iv.toString('hex'), authTag, encrypted, kdf: 'pbkdf2-sha512-100k' };
}

function decrypt(encData) {
  const key = getEncryptionKey();
  const iv = Buffer.from(encData.iv, 'hex');
  const authTag = Buffer.from(encData.authTag, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── Auth Provider Abstraction ───────────────────────────────────────

/**
 * Auth providers encapsulate how we authenticate to a mail service.
 * Currently: IMAP password auth only.
 * Future: Google OAuth2, Microsoft Graph tokens.
 */
const AUTH_PROVIDERS = {
  imap_password: {
    type: 'imap_password',
    label: 'IMAP Wachtwoord',
    connect: async (config) => {
      const client = new ImapFlow({
        host: config.host,
        port: config.port,
        secure: config.port === 993,
        auth: { user: config.email, pass: config.password },
        logger: false,
        connectionTimeout: CONNECTION_TIMEOUT,
        greetingTimeout: CONNECTION_TIMEOUT,
        socketTimeout: SOCKET_TIMEOUT
      });
      await client.connect();
      return client;
    }
  },
  // Placeholder for future OAuth providers
  google_oauth: {
    type: 'google_oauth',
    label: 'Google OAuth2',
    connect: async (_config) => {
      throw new Error('Google OAuth2 is nog niet beschikbaar. Gebruik IMAP met een app-wachtwoord.');
    }
  },
  microsoft_graph: {
    type: 'microsoft_graph',
    label: 'Microsoft Graph',
    connect: async (_config) => {
      throw new Error('Microsoft Graph is nog niet beschikbaar. Gebruik IMAP met je wachtwoord.');
    }
  }
};

function getAuthProvider(type) {
  return AUTH_PROVIDERS[type || 'imap_password'] || AUTH_PROVIDERS.imap_password;
}

// ── Credential Storage ──────────────────────────────────────────────

function sanitizeLeadId(leadId) {
  return String(leadId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function credPath(leadId) {
  return path.join(CRED_DIR, `${sanitizeLeadId(leadId)}.enc.json`);
}

function saveCredentials(leadId, { host, port, email, password, authType }) {
  const { iv, authTag, encrypted, kdf } = encrypt(password);
  const provider = detectProvider(email);
  const data = {
    version: 2,
    iv,
    authTag,
    encrypted,
    kdf,
    authType: authType || 'imap_password',
    host,
    port: Number(port),
    email,
    provider: provider ? provider.key : null,
    providerName: provider ? provider.name : null,
    connectedAt: new Date().toISOString(),
    lastValidatedAt: new Date().toISOString()
  };
  const filePath = credPath(leadId);
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
  return data;
}

function loadCredentials(leadId) {
  const filePath = credPath(leadId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function decryptPassword(credData) {
  return decrypt({
    iv: credData.iv,
    authTag: credData.authTag,
    encrypted: credData.encrypted
  });
}

function hasCredentials(leadId) {
  return fs.existsSync(credPath(leadId));
}

function deleteCredentials(leadId) {
  const filePath = credPath(leadId);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function listConfiguredLeads() {
  if (!fs.existsSync(CRED_DIR)) return [];
  return fs.readdirSync(CRED_DIR)
    .filter(f => f.endsWith('.enc.json'))
    .map(f => f.replace('.enc.json', ''));
}

// ── IMAP Connection Validation ──────────────────────────────────────

async function validateImapConnection({ host, port, email, password }) {
  const authProvider = getAuthProvider('imap_password');
  let client;

  try {
    client = await authProvider.connect({ host, port: Number(port), email, password });
    
    // Verify full access by opening INBOX
    const lock = await client.getMailboxLock('INBOX');
    const status = await client.status('INBOX', { messages: true, unseen: true });
    lock.release();

    // List available mailboxes for info
    let mailboxes = [];
    try {
      const list = await client.list();
      mailboxes = list.map(mb => ({
        path: mb.path,
        name: mb.name,
        specialUse: mb.specialUse || null,
        flags: mb.flags ? Array.from(mb.flags) : []
      })).slice(0, 20);
    } catch { /* non-critical */ }

    await client.logout();
    return {
      ok: true,
      messages: status.messages,
      unseen: status.unseen,
      mailboxes,
      capabilities: [] // Could be extracted from client
    };
  } catch (err) {
    try { if (client) await client.logout(); } catch {}
    
    let userMessage = err.message;
    const code = err.code || 'UNKNOWN';

    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      userMessage = `IMAP server '${host}' niet gevonden. Controleer de hostnaam.`;
    } else if (code === 'ECONNREFUSED') {
      userMessage = `Verbinding geweigerd op ${host}:${port}. Controleer host en poort.`;
    } else if (code === 'ETIMEDOUT' || code === 'TIMEOUT') {
      userMessage = `Verbinding naar ${host}:${port} timed out. Controleer firewall/poort.`;
    } else if (err.authenticationFailed || /auth|AUTH|credentials|LOGIN|password/i.test(err.message)) {
      const provider = detectProvider(email);
      const extra = provider?.requiresAppPassword
        ? ` ${provider.notes}`
        : '';
      userMessage = `Authenticatie mislukt. Controleer email en wachtwoord.${extra}`;
    } else if (/certificate|CERT|ssl|tls/i.test(err.message)) {
      userMessage = `SSL/TLS certificaat probleem met ${host}. Probeer poort 993 met SSL.`;
    }
    
    return { ok: false, error: userMessage, code, rawError: err.message };
  }
}

// ── Connection Health Tracking ──────────────────────────────────────

const connectionHealth = new Map(); // leadId -> health object

function getConnectionHealth(leadId) {
  return connectionHealth.get(leadId) || {
    consecutiveFailures: 0,
    totalPolls: 0,
    totalFetched: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    status: 'unknown',
    backoffMs: 0,
    pausedUntil: null
  };
}

function recordPollSuccess(leadId, fetchedCount) {
  const health = getConnectionHealth(leadId);
  health.consecutiveFailures = 0;
  health.totalPolls++;
  health.totalFetched += fetchedCount;
  health.lastSuccessAt = new Date().toISOString();
  health.lastError = null;
  health.status = 'healthy';
  health.backoffMs = 0;
  health.pausedUntil = null;
  connectionHealth.set(leadId, health);
}

function recordPollFailure(leadId, error) {
  const health = getConnectionHealth(leadId);
  health.consecutiveFailures++;
  health.totalPolls++;
  health.lastFailureAt = new Date().toISOString();
  health.lastError = error;
  
  // Exponential backoff: 30s, 1m, 2m, 4m, 8m, 16m, 32m, max 60m
  health.backoffMs = Math.min(
    MAX_BACKOFF_MS,
    30_000 * Math.pow(2, health.consecutiveFailures - 1)
  );

  if (health.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    health.status = 'paused';
    health.pausedUntil = new Date(Date.now() + MAX_BACKOFF_MS).toISOString();
    console.log(`[IMAP] Auto-poll PAUSED for ${leadId} after ${health.consecutiveFailures} failures. Resume at ${health.pausedUntil}`);
  } else {
    health.status = 'degraded';
  }

  connectionHealth.set(leadId, health);
}

function shouldPoll(leadId) {
  const health = getConnectionHealth(leadId);
  if (health.status === 'paused' && health.pausedUntil) {
    if (new Date() < new Date(health.pausedUntil)) return false;
    // Reset pause
    health.status = 'degraded';
    health.pausedUntil = null;
    connectionHealth.set(leadId, health);
  }
  if (health.backoffMs > 0 && health.lastFailureAt) {
    const nextAttempt = new Date(health.lastFailureAt).getTime() + health.backoffMs;
    if (Date.now() < nextAttempt) return false;
  }
  return true;
}

// ── IMAP Polling Engine ─────────────────────────────────────────────

const pollingState = new Map(); // leadId -> { status, error, lastPoll }

function getLeadInboxDir(leadId) {
  const safe = sanitizeLeadId(leadId);
  const dir = path.join(INBOX_DIR, safe);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getLeadTriageDir(leadId) {
  const safe = sanitizeLeadId(leadId);
  const dir = path.join(TRIAGE_DIR, safe);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function pollLeadInbox(leadId, { force = false } = {}) {
  // Check if we should poll (backoff/pause check)
  if (!force && !shouldPoll(leadId)) {
    const health = getConnectionHealth(leadId);
    return {
      ok: false,
      error: `Polling paused (backoff: ${Math.round(health.backoffMs / 1000)}s, failures: ${health.consecutiveFailures})`,
      skipped: true,
      fetched: 0,
      messages: []
    };
  }

  const cred = loadCredentials(leadId);
  if (!cred) {
    updatePollingStatus(leadId, 'error', 'Geen IMAP credentials gevonden');
    return { ok: false, error: 'no_credentials', fetched: 0, messages: [] };
  }

  const password = decryptPassword(cred);
  updatePollingStatus(leadId, 'polling', null);

  const authProvider = getAuthProvider(cred.authType);
  let client;
  let fetchedCount = 0;
  const messages = [];

  try {
    client = await authProvider.connect({
      host: cred.host,
      port: cred.port,
      email: cred.email,
      password
    });

    const lock = await client.getMailboxLock('INBOX');

    try {
      const unseenUids = await client.search({ seen: false }, { uid: true });
      
      if (unseenUids.length === 0) {
        recordPollSuccess(leadId, 0);
        updatePollingStatus(leadId, 'connected', null, new Date().toISOString());
        lock.release();
        await client.logout();
        return { ok: true, fetched: 0, messages: [], unseenCount: 0 };
      }

      const uidsToFetch = unseenUids.slice(0, MAX_MESSAGES_PER_POLL);
      
      for (const uid of uidsToFetch) {
        try {
          const msg = await client.fetchOne(uid, {
            uid: true,
            envelope: true,
            source: true,
            flags: true
          }, { uid: true });

          if (msg && msg.source) {
            const parsed = await simpleParser(msg.source);
            
            const emailData = {
              uid: msg.uid,
              messageId: parsed.messageId || `uid-${msg.uid}`,
              subject: parsed.subject || '(geen onderwerp)',
              from: parsed.from ? parsed.from.text : '(onbekend)',
              fromAddress: parsed.from?.value?.[0]?.address || null,
              fromName: parsed.from?.value?.[0]?.name || null,
              to: parsed.to ? parsed.to.text : '',
              toAddress: parsed.to?.value?.[0]?.address || null,
              cc: parsed.cc ? parsed.cc.text : null,
              replyTo: parsed.replyTo ? parsed.replyTo.text : null,
              date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
              textBody: (parsed.text || '').slice(0, 10000),
              htmlBody: (parsed.html || '').slice(0, 50000),
              hasAttachments: (parsed.attachments || []).length > 0,
              attachmentCount: (parsed.attachments || []).length,
              attachments: (parsed.attachments || []).map(a => ({
                filename: a.filename || '(naamloos)',
                contentType: a.contentType || 'application/octet-stream',
                size: a.size || 0
              })),
              headers: {
                inReplyTo: parsed.inReplyTo || null,
                references: parsed.references || null,
                priority: parsed.priority || 'normal'
              },
              fetchedAt: new Date().toISOString(),
              leadId,
              provider: cred.provider || null
            };

            // Save raw email data
            const inboxDir = getLeadInboxDir(leadId);
            const fileName = `${emailData.date.replace(/[:.]/g, '-')}_uid${msg.uid}.json`;
            const filePath = path.join(inboxDir, fileName);
            fs.writeFileSync(filePath, JSON.stringify(emailData, null, 2), 'utf8');

            // Run triage pipeline
            const triage = triageEmail(emailData);
            emailData.triage = triage;

            // Save triage result
            const triageDir = getLeadTriageDir(leadId);
            const triagePath = path.join(triageDir, `${fileName}`);
            fs.writeFileSync(triagePath, JSON.stringify({ ...emailData, triage }, null, 2), 'utf8');

            messages.push(emailData);
            fetchedCount++;

            // Mark as SEEN
            await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
          }
        } catch (msgErr) {
          console.error(`[IMAP] Error fetching uid ${uid} for ${leadId}:`, msgErr.message);
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
    recordPollSuccess(leadId, fetchedCount);
    updatePollingStatus(leadId, 'connected', null, new Date().toISOString());
    
    return {
      ok: true,
      fetched: fetchedCount,
      messages,
      remainingUnseen: Math.max(0, (await getInboxStats(leadId)).unseen - fetchedCount)
    };
  } catch (err) {
    try { if (client) await client.logout(); } catch {}
    const errorMsg = err.message || 'Polling failed';
    recordPollFailure(leadId, errorMsg);
    updatePollingStatus(leadId, 'error', errorMsg);
    return { ok: false, error: errorMsg, fetched: fetchedCount, messages };
  }
}

async function getInboxStats(leadId) {
  // Returns count from stored messages — not a live IMAP query
  return { unseen: 0 }; // Placeholder; real unseen comes from poll
}

function updatePollingStatus(leadId, status, error, lastPoll) {
  const current = pollingState.get(leadId) || {};
  pollingState.set(leadId, {
    ...current,
    status,
    error: error || null,
    lastPoll: lastPoll || current.lastPoll || null,
    updatedAt: new Date().toISOString()
  });
}

function getPollingStatus(leadId) {
  const hasCreds = hasCredentials(leadId);
  if (!hasCreds) return { status: 'disconnected', error: null, lastPoll: null };
  
  const state = pollingState.get(leadId);
  const health = getConnectionHealth(leadId);
  
  if (!state) return {
    status: 'connected',
    error: null,
    lastPoll: null,
    health: { consecutiveFailures: 0, status: 'unknown' }
  };

  return {
    status: state.status,
    error: state.error,
    lastPoll: state.lastPoll,
    updatedAt: state.updatedAt,
    health: {
      consecutiveFailures: health.consecutiveFailures,
      totalPolls: health.totalPolls,
      totalFetched: health.totalFetched,
      lastSuccessAt: health.lastSuccessAt,
      status: health.status,
      backoffMs: health.backoffMs
    }
  };
}

// ── Triage Pipeline (rule-based, extensible with AI) ────────────────

/**
 * Triage an email into priority buckets with summary and draft hooks.
 * This is the rule-based engine; AI processing can be layered on top
 * by calling an external LLM API for summary/draft generation.
 */
function triageEmail(emailData) {
  const subject = (emailData.subject || '').toLowerCase();
  const body = (emailData.textBody || '').toLowerCase();
  const combined = `${subject} ${body}`;

  // Priority scoring
  let score = 50;
  let bucket = 'P3 — Op schema';
  const signals = [];

  // P1 signals: urgency
  const urgentPatterns = [
    /urgent|dringend|asap|spoed|critical|noodgeval|immediately|direct/,
    /deadline.*vandaag|today.*deadline|vervaldatum|overdue|te laat/,
    /storing|outage|incident|security.*breach|data.*lek/
  ];
  for (const pattern of urgentPatterns) {
    if (pattern.test(combined)) {
      score += 20;
      signals.push('urgency_keyword');
    }
  }

  // P2 signals: revenue & business
  const revenuePatterns = [
    /factuur|invoice|betaling|payment|offerte|quote|order|bestelling/,
    /contract|overeenkomst|agreement|proposal|aanbieding|tender/,
    /klacht|complaint|escalatie|escalation|ontevreden/
  ];
  for (const pattern of revenuePatterns) {
    if (pattern.test(combined)) {
      score += 15;
      signals.push('revenue_signal');
    }
  }

  // P2 signals: action required
  const actionPatterns = [
    /bevestig|confirm|accordeer|approve|onderteken|sign|review|controleer/,
    /reageer|reply|antwoord|respond|terugkoppeling|feedback/,
    /planning|vergadering|meeting|afspraak|appointment/
  ];
  for (const pattern of actionPatterns) {
    if (pattern.test(combined)) {
      score += 10;
      signals.push('action_required');
    }
  }

  // Lower priority signals
  const lowPriorityPatterns = [
    /newsletter|nieuwsbrief|unsubscribe|uitschrijven|no-?reply/,
    /notification|melding|update.*account|marketing|promotie/,
    /social media|linkedin|facebook|twitter|instagram/
  ];
  for (const pattern of lowPriorityPatterns) {
    if (pattern.test(combined)) {
      score -= 15;
      signals.push('low_priority');
    }
  }

  // Spam signals
  const spamPatterns = [
    /viagra|casino|lottery|loterij|you.*won|congratulations.*winner/,
    /nigerian.*prince|inheritance|million.*dollars/
  ];
  for (const pattern of spamPatterns) {
    if (pattern.test(combined)) {
      score -= 40;
      signals.push('spam_signal');
    }
  }

  // Email header priority
  if (emailData.headers?.priority === 'high') {
    score += 15;
    signals.push('header_priority_high');
  }

  // Attachment bonus (might be important docs)
  if (emailData.hasAttachments) {
    score += 5;
    signals.push('has_attachments');
  }

  // Determine bucket
  score = Math.max(0, Math.min(100, score));
  if (score >= 80) bucket = 'P1 — Direct handelen';
  else if (score >= 60) bucket = 'P2 — Vandaag afronden';
  else if (score >= 30) bucket = 'P3 — Op schema';
  else bucket = 'P4 — Informatief / low priority';

  // Generate auto-summary (rule-based; AI can enhance this)
  const summary = generateSummary(emailData);

  // Suggest reply category
  const replyCategory = suggestReplyCategory(emailData, signals);

  return {
    bucket,
    score,
    signals,
    summary,
    replyCategory,
    triageAt: new Date().toISOString(),
    engine: 'rule-based-v2',
    // Hook: set to true when AI processing is done
    aiProcessed: false,
    aiSummary: null,
    aiDraft: null
  };
}

function generateSummary(emailData) {
  const body = (emailData.textBody || '').trim();
  if (!body) return emailData.subject || '(leeg bericht)';
  
  // First 300 chars, clean up whitespace
  const cleaned = body.replace(/\s+/g, ' ').slice(0, 300);
  return cleaned + (body.length > 300 ? '...' : '');
}

function suggestReplyCategory(emailData, signals) {
  if (signals.includes('spam_signal')) return 'ignore';
  if (signals.includes('low_priority')) return 'acknowledge';
  if (signals.includes('urgency_keyword')) return 'urgent_reply';
  if (signals.includes('revenue_signal')) return 'business_reply';
  if (signals.includes('action_required')) return 'action_reply';
  return 'standard_reply';
}

// ── Auto-Polling Scheduler ──────────────────────────────────────────

const pollTimers = new Map();

function startAutoPoll(leadId) {
  if (pollTimers.has(leadId)) return;
  
  console.log(`[IMAP] Starting auto-poll for ${leadId} (every ${POLL_INTERVAL_MS / 1000}s)`);
  
  // Poll immediately
  pollLeadInbox(leadId).catch(err => {
    console.error(`[IMAP] Initial poll error for ${leadId}:`, err.message);
  });
  
  // Then on interval (with backoff check built into pollLeadInbox)
  const timer = setInterval(() => {
    pollLeadInbox(leadId).catch(err => {
      console.error(`[IMAP] Auto-poll error for ${leadId}:`, err.message);
    });
  }, POLL_INTERVAL_MS);
  
  pollTimers.set(leadId, timer);
}

function stopAutoPoll(leadId) {
  const timer = pollTimers.get(leadId);
  if (timer) {
    clearInterval(timer);
    pollTimers.delete(leadId);
    console.log(`[IMAP] Stopped auto-poll for ${leadId}`);
  }
}

function startAllAutoPolls() {
  const leads = listConfiguredLeads();
  for (const leadId of leads) {
    startAutoPoll(leadId);
  }
  if (leads.length > 0) {
    console.log(`[IMAP] Auto-polling started for ${leads.length} lead(s)`);
  }
}

function resetPollHealth(leadId) {
  connectionHealth.delete(leadId);
  console.log(`[IMAP] Poll health reset for ${leadId}`);
}

// ── Message Retrieval ───────────────────────────────────────────────

function getStoredMessages(leadId, limit = 50) {
  const dir = getLeadInboxDir(leadId);
  if (!fs.existsSync(dir)) return [];
  
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit);
  
  return files.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function getTriagedMessages(leadId, limit = 50) {
  const dir = getLeadTriageDir(leadId);
  if (!fs.existsSync(dir)) return [];
  
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit);
  
  return files.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function getMessageCount(leadId) {
  const dir = getLeadInboxDir(leadId);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).length;
}

// ── Rate Limiting ───────────────────────────────────────────────────

const setupAttempts = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const attempts = (setupAttempts.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW);
  setupAttempts.set(ip, attempts);
  
  if (attempts.length >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: Math.ceil((attempts[0] + RATE_LIMIT_WINDOW - now) / 1000)
    };
  }
  
  return { allowed: true, remaining: RATE_LIMIT_MAX - attempts.length };
}

function recordSetupAttempt(ip) {
  const attempts = setupAttempts.get(ip) || [];
  attempts.push(Date.now());
  setupAttempts.set(ip, attempts);
}

// ── Metrics / Dashboard Data ────────────────────────────────────────

function getEngineMetrics() {
  const leads = listConfiguredLeads();
  const metrics = {
    totalConfiguredLeads: leads.length,
    activePollers: pollTimers.size,
    leads: {}
  };

  for (const leadId of leads) {
    const health = getConnectionHealth(leadId);
    const status = getPollingStatus(leadId);
    const messageCount = getMessageCount(leadId);
    
    metrics.leads[leadId] = {
      messageCount,
      ...status,
      health: {
        consecutiveFailures: health.consecutiveFailures,
        totalPolls: health.totalPolls,
        totalFetched: health.totalFetched,
        lastSuccessAt: health.lastSuccessAt,
        lastFailureAt: health.lastFailureAt,
        status: health.status
      }
    };
  }

  return metrics;
}

// ── Exports ─────────────────────────────────────────────────────────

module.exports = {
  // Provider detection
  detectProvider,
  suggestImapSettings,
  
  // Credentials
  saveCredentials,
  loadCredentials,
  hasCredentials,
  deleteCredentials,
  decryptPassword,
  listConfiguredLeads,
  
  // Validation
  validateImapConnection,
  
  // Polling
  pollLeadInbox,
  getPollingStatus,
  startAutoPoll,
  stopAutoPoll,
  startAllAutoPolls,
  resetPollHealth,
  getConnectionHealth,
  
  // Triage
  triageEmail,
  getTriagedMessages,
  
  // Messages
  getStoredMessages,
  getMessageCount,
  
  // Rate limiting
  checkRateLimit,
  recordSetupAttempt,
  
  // Metrics
  getEngineMetrics,
  
  // Encryption (for testing)
  encrypt,
  decrypt,
  
  // Auth providers (for extensibility)
  AUTH_PROVIDERS,
  getAuthProvider,
  
  // Constants (for testing/config)
  KNOWN_PROVIDERS
};
