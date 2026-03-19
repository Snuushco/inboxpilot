const { handleCors } = require('../../lib/helpers');
const crypto = require('crypto');

// Vercel provides raw body for webhook verification
module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const sigHeader = req.headers['stripe-signature'] || null;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || null;

  // Parse event
  let event;
  try {
    event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'invalid_json' });
  }

  if (!event || !event.type || !event.data || !event.data.object) {
    return res.status(400).json({ ok: false, error: 'invalid_event_structure' });
  }

  // Verify signature if secret is configured
  if (webhookSecret && sigHeader) {
    const elements = sigHeader.split(',').reduce((acc, item) => {
      const [k, v] = item.split('=');
      if (k === 't') acc.timestamp = v;
      if (k === 'v1') acc.signatures.push(v);
      return acc;
    }, { timestamp: null, signatures: [] });

    if (elements.timestamp) {
      const signedPayload = `${elements.timestamp}.${typeof req.body === 'string' ? req.body : JSON.stringify(req.body)}`;
      const expected = crypto.createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');
      const verified = elements.signatures.some(sig => {
        try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
      });
      if (!verified) {
        console.error('[WEBHOOK] Signature verification failed');
        return res.status(400).json({ ok: false, error: 'signature_invalid' });
      }
    }
  }

  console.log(`[WEBHOOK] Received: ${event.type} (id=${event.id || 'none'})`);

  // Process event — store in /tmp for now, full billing module later
  const result = { processed: true, type: event.type, timestamp: new Date().toISOString() };
  
  res.status(200).json({ ok: true, received: true, type: event.type, result });
};
