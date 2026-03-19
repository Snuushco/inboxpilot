const { handleCors } = require('../../lib/helpers');

const PROVIDER_MAP = {
  'gmail.com': { host: 'imap.gmail.com', port: 993, tls: true, note: 'Gebruik App Password (2FA vereist)' },
  'googlemail.com': { host: 'imap.gmail.com', port: 993, tls: true, note: 'Gebruik App Password' },
  'outlook.com': { host: 'outlook.office365.com', port: 993, tls: true, note: 'Microsoft 365 IMAP' },
  'hotmail.com': { host: 'outlook.office365.com', port: 993, tls: true, note: 'Microsoft 365 IMAP' },
  'live.com': { host: 'outlook.office365.com', port: 993, tls: true, note: 'Microsoft 365 IMAP' },
  'live.nl': { host: 'outlook.office365.com', port: 993, tls: true, note: 'Microsoft 365 IMAP' },
  'yahoo.com': { host: 'imap.mail.yahoo.com', port: 993, tls: true, note: 'Gebruik App Password' },
  'ziggo.nl': { host: 'imap.ziggo.nl', port: 993, tls: true },
  'kpnmail.nl': { host: 'imap.kpnmail.nl', port: 993, tls: true },
  'strato.de': { host: 'imap.strato.de', port: 993, tls: true },
  'praesidion.com': { host: 'imap.strato.de', port: 993, tls: true }
};

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const email = req.query.email;
  if (!email) return res.status(400).json({ ok: false, error: 'email parameter required' });

  const domain = email.split('@')[1]?.toLowerCase();
  const suggestion = PROVIDER_MAP[domain] || { host: `imap.${domain}`, port: 993, tls: true, note: 'Auto-detect: controleer je provider instellingen' };

  res.status(200).json({ ok: true, email, domain, ...suggestion });
};
