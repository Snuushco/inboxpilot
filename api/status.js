const { handleCors, redactLead, getLatestLead } = require('../lib/helpers');
const storage = require('../lib/storage');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const latest = getLatestLead();
  res.status(200).json({
    ok: true,
    status: {
      ok: true,
      service: 'sortbox-mvp',
      platform: 'vercel',
      emailEnabled: !!process.env.RESEND_API_KEY,
      counts: { totalEvents: 0, uniqueLeads: 0, duplicates: 0 },
      latestLead: redactLead(latest)
    },
    latest: { ok: true, latest: redactLead(latest) }
  });
};
