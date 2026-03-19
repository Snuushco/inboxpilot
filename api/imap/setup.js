const { handleCors } = require('../../lib/helpers');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  res.status(200).json({
    ok: false,
    error: 'IMAP setup requires a persistent server connection. This feature is available in the self-hosted version.',
    hint: 'Contact emily@praesidion.com for assisted IMAP setup.'
  });
};
