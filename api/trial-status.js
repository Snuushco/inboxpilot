const { handleCors, findLeadById, getLatestLead, normalizePlan, CHECKOUT_LINKS } = require('../lib/helpers');
const { PLAN_CONFIG } = require('../lib/demo-engine');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const leadId = req.query.leadId || req.query.lead;
  const lead = findLeadById(leadId) || getLatestLead();
  if (!lead) return res.status(200).json({ ok: true, status: 'no_lead', trial: null });

  const signupDate = new Date(lead.submittedAt || Date.now());
  const trialEndDate = new Date(signupDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const daysRemaining = Math.max(0, Math.ceil((trialEndDate - now) / (24 * 60 * 60 * 1000)));
  const planKey = lead.planKey || normalizePlan(lead.plan || '') || 'team';
  const planConfig = PLAN_CONFIG[planKey] || PLAN_CONFIG.team;
  const prices = { solo: 49, pro: 149, team: 349, ops: 749, enterprise: 1500 };

  res.status(200).json({
    ok: true,
    status: 'trial_active',
    trial: {
      planKey,
      planLabel: planConfig.label,
      startDate: signupDate.toISOString(),
      endDate: trialEndDate.toISOString(),
      daysRemaining,
      monthlyPrice: prices[planKey] || 0,
      billingStarts: trialEndDate.toISOString(),
      month2: {
        summary: `Na je gratis trial wordt je ${planConfig.label}-plan automatisch voortgezet voor €${prices[planKey] || 0}/maand.`,
        cancellation: 'Je kunt op elk moment opzeggen via je dashboard of door te mailen naar emily@praesidion.com.',
        reminder: 'Je ontvangt op dag 27 een e-mail met de vraag of je door wilt gaan.'
      }
    },
    checkout: lead.checkout || CHECKOUT_LINKS[planKey] || null
  });
};
