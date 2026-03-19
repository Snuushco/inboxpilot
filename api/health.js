const { handleCors } = require('../lib/helpers');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  res.status(200).json({
    ok: true,
    service: 'inboxpilot-mvp',
    platform: 'vercel',
    startedAt: new Date().toISOString(),
    emailEnabled: !!process.env.RESEND_API_KEY
  });
};
