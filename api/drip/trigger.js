const { handleCors } = require('../../lib/helpers');
const drip = require('../../lib/drip-engine');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  
  const leadId = req.query.leadId || req.body?.leadId;
  const dayParam = req.query.day || req.body?.day;
  const email = req.query.email || req.body?.email;
  const firstName = req.query.firstName || req.body?.firstName;
  const company = req.query.company || req.body?.company;
  const planKey = req.query.planKey || req.body?.planKey || 'team';
  
  if (!leadId) return res.status(400).json({ ok: false, error: 'missing_leadId' });
  if (dayParam === undefined || dayParam === null) return res.status(400).json({ ok: false, error: 'missing_day' });
  
  const dayNum = parseInt(dayParam, 10);
  
  try {
    // Try existing drip schedule first
    const result = await drip.sendDripEmail(leadId, dayNum);
    return res.status(200).json({ ok: true, result });
  } catch (scheduleErr) {
    // If no drip schedule exists (e.g., Vercel cold start), send directly if email provided
    if (!email) {
      return res.status(400).json({ 
        ok: false, 
        error: 'no_drip_schedule_and_no_email',
        hint: 'Provide email, firstName, company, planKey for stateless sending',
        originalError: scheduleErr.message 
      });
    }
    
    try {
      // Create ephemeral schedule and send
      const lead = {
        leadId, email, firstName: firstName || 'daar',
        company: company || '', planKey,
        submittedAt: new Date().toISOString()
      };
      drip.initDripSchedule(lead);
      const result = await drip.sendDripEmail(leadId, dayNum);
      return res.status(200).json({ ok: true, result, note: 'sent_via_ephemeral_schedule' });
    } catch (sendErr) {
      return res.status(500).json({ ok: false, error: sendErr.message });
    }
  }
};
