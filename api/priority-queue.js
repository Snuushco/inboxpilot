const { handleCors, findLeadById, getLatestLead } = require('../lib/helpers');
const { buildWorkspace } = require('../lib/workspace');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const leadId = req.query.leadId || req.query.lead;
  const lead = findLeadById(leadId) || getLatestLead();
  const workspace = buildWorkspace(lead);
  res.status(200).json({ ok: true, generatedAt: workspace.generatedAt, queue: workspace.priorityQueue });
};
