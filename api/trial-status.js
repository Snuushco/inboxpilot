const store = require('../lib/store');
const { PLAN_CONFIG } = require('../lib/demo-engine');
const { sendJson, handleCors } = require('../lib/response');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  store.initStore();

  const leadId = req.query.leadId || req.query.lead;
  const lead = store.findLeadById(leadId) || store.getLatestLead();
  if (!lead) return sendJson(res, 200, { ok: true, status: 'no_lead', trial: null });

  const signupDate = new Date(lead.submittedAt || Date.now());
  const trialEndDate = new Date(signupDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const daysRemaining = Math.max(0, Math.ceil((trialEndDate - now) / (24 * 60 * 60 * 1000)));
  const planKey = lead.planKey || store.normalizePlan(lead.plan || '') || 'team';
  const planConfig = PLAN_CONFIG[planKey] || PLAN_CONFIG.team;
  const prices = { solo: 49, pro: 149, team: 349, ops: 749, enterprise: 1500 };

  return sendJson(res, 200, {
    ok: true, status: 'trial_active',
    trial: {
      planKey, planLabel: planConfig.label,
      startDate: signupDate.toISOString(), endDate: trialEndDate.toISOString(),
      daysRemaining, monthlyPrice: prices[planKey] || 0,
      billingStarts: trialEndDate.toISOString(),
      month2: {
        summary: `Na je gratis trial wordt je ${planConfig.label}-plan voortgezet voor €${prices[planKey] || 0}/maand.`,
        cancellation: 'Op elk moment opzegbaar via je dashboard of emily@praesidion.com.',
        reminder: 'Je ontvangt op dag 27 een herinnering. Geen actie = voortzetting. Opzeggen = €0.'
      }
    },
    checkout: lead.checkout || store.CHECKOUT_LINKS[planKey] || null
  });
};
