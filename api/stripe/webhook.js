const billing = require('../../lib/billing');
const { sendJson, handleCors } = require('../../lib/response');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  const sigHeader = req.headers['stripe-signature'] || null;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || null;
  const sigResult = billing.verifyStripeSignature(rawBody, sigHeader, webhookSecret);
  if (sigResult.reject) return sendJson(res, 400, { ok: false, error: 'webhook_signature_invalid', reason: sigResult.reason });

  let event;
  try { event = typeof req.body === 'object' ? req.body : JSON.parse(rawBody); }
  catch { return sendJson(res, 400, { ok: false, error: 'invalid_json' }); }

  if (!event?.type || !event?.data?.object) return sendJson(res, 400, { ok: false, error: 'invalid_event_structure' });
  const result = billing.processWebhookEvent(event.type, event.data.object);
  return sendJson(res, 200, { ok: true, received: true, type: event.type, result });
};
