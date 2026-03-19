const { handleCors, findLeadById, getLatestLead } = require('../lib/helpers');
const { buildWorkspace } = require('../lib/workspace');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const leadId = req.query.leadId || req.query.lead;
  const lead = findLeadById(leadId) || getLatestLead();
  const workspace = buildWorkspace(lead);
  
  // Add billing stub
  workspace.billing = {
    access: 'trial',
    status: 'trial_active',
    message: null,
    gracePeriodEnd: null,
    billingState: null
  };

  res.status(200).json(workspace);
};
