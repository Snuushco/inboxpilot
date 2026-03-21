/**
 * InboxPilot IMAP Engine (Serverless)
 * Simplified for on-demand polling. No persistent connections or timers.
 * IMAP credentials stored encrypted in /tmp/ (ephemeral).
 * Production: use Vercel KV or Upstash Redis for state.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const CRED_DIR = path.join(store.DATA_DIR, 'imap-credentials');
const INBOX_DIR = path.join(store.DATA_DIR, 'inbox');

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT = 'inboxpilot-v2-salt';

// Provider detection
const KNOWN_PROVIDERS = {
  gmail: { name: 'Gmail', imapHost: 'imap.gmail.com', imapPort: 993, domains: ['gmail.com', 'googlemail.com'], requiresAppPassword: true, notes: 'Vereist een app-wachtwoord.' },
  outlook: { name: 'Outlook / Microsoft 365', imapHost: 'outlook.office365.com', imapPort: 993, domains: ['outlook.com', 'hotmail.com', 'live.com', 'live.nl'], requiresAppPassword: false, notes: '' },
  strato: { name: 'Strato', imapHost: 'imap.strato.de', imapPort: 993, domains: [], requiresAppPassword: false, notes: '' },
  ziggo: { name: 'Ziggo', imapHost: 'imap.ziggo.nl', imapPort: 993, domains: ['ziggo.nl'], requiresAppPassword: false, notes: '' }
};

function detectProvider(email) {
  if (!email || !email.includes('@')) return null;
  const domain = email.split('@')[1].toLowerCase();
  for (const [key, provider] of Object.entries(KNOWN_PROVIDERS)) {
    if (provider.domains.includes(domain)) return { key, ...provider };
  }
  return null;
}

function suggestImapSettings(email) {
  const provider = detectProvider(email);
  if (provider) return { detected: true, provider: provider.name, host: provider.imapHost, port: provider.imapPort, requiresAppPassword: provider.requiresAppPassword, notes: provider.notes };
  const domain = email.split('@')[1];
  return { detected: false, provider: null, host: `imap.${domain}`, port: 993, requiresAppPassword: false, notes: `Probeer imap.${domain}:993 met SSL.` };
}

// Encryption
function getEncryptionKey() {
  const keyMaterial = process.env.IMAP_ENCRYPTION_KEY;
  if (!keyMaterial) throw new Error('IMAP_ENCRYPTION_KEY environment variable not set');
  return crypto.pbkdf2Sync(keyMaterial, PBKDF2_SALT, PBKDF2_ITERATIONS, 32, 'sha512');
}

function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex'), encrypted };
}

function decrypt(encData) {
  const key = getEncryptionKey();
  const iv = Buffer.from(encData.iv, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(encData.authTag, 'hex'));
  let decrypted = decipher.update(encData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function sanitizeLeadId(leadId) { return String(leadId).replace(/[^a-zA-Z0-9_-]/g, '_'); }
function credPath(leadId) { return path.join(CRED_DIR, `${sanitizeLeadId(leadId)}.enc.json`); }

function saveCredentials(leadId, { host, port, email, password }) {
  store.ensureDir(CRED_DIR);
  const { iv, authTag, encrypted } = encrypt(password);
  const provider = detectProvider(email);
  const data = {
    version: 2, iv, authTag, encrypted, host, port: Number(port), email,
    provider: provider ? provider.key : null, connectedAt: new Date().toISOString()
  };
  store.writeJsonAtomic(credPath(leadId), data);
  return data;
}

function loadCredentials(leadId) {
  try { return JSON.parse(fs.readFileSync(credPath(leadId), 'utf8')); } catch { return null; }
}

function hasCredentials(leadId) { return fs.existsSync(credPath(leadId)); }
function deleteCredentials(leadId) { const fp = credPath(leadId); if (fs.existsSync(fp)) fs.unlinkSync(fp); }

function getStoredMessages(leadId, limit = 50) {
  const dir = path.join(INBOX_DIR, sanitizeLeadId(leadId));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse().slice(0, limit)
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } })
    .filter(Boolean);
}

function getMessageCount(leadId) {
  const dir = path.join(INBOX_DIR, sanitizeLeadId(leadId));
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).length;
}

function getPollingStatus(leadId) {
  return hasCredentials(leadId)
    ? { status: 'connected', error: null, lastPoll: null, note: 'Serverless mode: use /api/imap/poll for on-demand polling' }
    : { status: 'disconnected' };
}

function getEngineMetrics() {
  store.ensureDir(CRED_DIR);
  let leads = [];
  try { leads = fs.readdirSync(CRED_DIR).filter(f => f.endsWith('.enc.json')).map(f => f.replace('.enc.json', '')); } catch {}
  const metrics = { totalConfiguredLeads: leads.length, activePollers: 0, note: 'Serverless: no persistent pollers', leads: {} };
  for (const leadId of leads) {
    metrics.leads[leadId] = { messageCount: getMessageCount(leadId), status: getPollingStatus(leadId) };
  }
  return metrics;
}

/**
 * Live IMAP fetch using imapflow.
 * Connects to the mailbox, fetches recent messages from INBOX, stores them locally.
 */
async function fetchLiveMessages(leadId, { maxMessages = 20 } = {}) {
  const creds = loadCredentials(leadId);
  if (!creds) throw new Error(`No IMAP credentials found for lead ${leadId}`);

  const password = decrypt({ iv: creds.iv, authTag: creds.authTag, encrypted: creds.encrypted });
  const { ImapFlow } = require('imapflow');

  const client = new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: true,
    auth: { user: creds.email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: true }
  });

  const fetched = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const status = client.mailbox;
      const totalMessages = status.exists || 0;
      if (totalMessages === 0) {
        return { fetched: [], totalInMailbox: 0, newStored: 0 };
      }

      // Fetch the most recent N messages
      const startSeq = Math.max(1, totalMessages - maxMessages + 1);
      const range = `${startSeq}:*`;

      for await (const msg of client.fetch(range, {
        envelope: true,
        bodyStructure: true,
        source: { maxBytes: 50000 } // limit body size
      })) {
        const envelope = msg.envelope || {};
        const fromAddr = envelope.from && envelope.from[0] ? envelope.from[0] : {};
        const toAddr = envelope.to && envelope.to[0] ? envelope.to[0] : {};

        // Extract text body from source if available
        let textBody = '';
        if (msg.source) {
          const raw = msg.source.toString('utf8');
          // Simple extraction: get text after double newline (headers end)
          const bodyStart = raw.indexOf('\r\n\r\n');
          if (bodyStart > -1) {
            textBody = raw.slice(bodyStart + 4, bodyStart + 2004).replace(/=\r?\n/g, '');
          }
        }

        const parsed = {
          uid: msg.uid,
          seq: msg.seq,
          messageId: envelope.messageId || `seq-${msg.seq}`,
          subject: envelope.subject || '(no subject)',
          from: fromAddr.address || '',
          fromName: fromAddr.name || '',
          fromAddress: fromAddr.address || '',
          to: toAddr.address || '',
          date: envelope.date ? new Date(envelope.date).toISOString() : new Date().toISOString(),
          hasAttachments: !!(msg.bodyStructure && msg.bodyStructure.childNodes && msg.bodyStructure.childNodes.length > 1),
          attachmentCount: msg.bodyStructure && msg.bodyStructure.childNodes ? Math.max(0, msg.bodyStructure.childNodes.length - 1) : 0,
          textBody: textBody.slice(0, 2000),
          fetchedAt: new Date().toISOString()
        };
        fetched.push(parsed);
      }

      // Store messages locally
      const inboxDir = path.join(INBOX_DIR, sanitizeLeadId(leadId));
      store.ensureDir(inboxDir);
      let newStored = 0;
      for (const msg of fetched) {
        const filename = `${msg.uid || msg.seq}.json`;
        const filepath = path.join(inboxDir, filename);
        if (!fs.existsSync(filepath)) {
          store.writeJsonAtomic(filepath, msg);
          newStored++;
        }
      }

      return { fetched, totalInMailbox: totalMessages, newStored };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

module.exports = {
  detectProvider, suggestImapSettings,
  saveCredentials, loadCredentials, hasCredentials, deleteCredentials,
  getStoredMessages, getMessageCount, getPollingStatus, getEngineMetrics,
  encrypt, decrypt, KNOWN_PROVIDERS,
  fetchLiveMessages
};
