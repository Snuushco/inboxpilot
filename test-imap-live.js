/**
 * InboxPilot IMAP Live Test
 * Tests the full IMAP setup + polling flow with a real mailbox.
 * Usage: IMAP_ENCRYPTION_KEY=<key> node test-imap-live.js
 */
const path = require('path');

// Set IMAP_ENCRYPTION_KEY if not set
if (!process.env.IMAP_ENCRYPTION_KEY) {
  process.env.IMAP_ENCRYPTION_KEY = 'test-encryption-key-inboxpilot-2026';
}

const imap = require('./lib/imap-engine');
const store = require('./lib/store');

const TEST_LEAD_ID = 'test_imap_live_001';

// Strato IMAP config for emily@praesidion.com
const TEST_CONFIG = {
  host: 'imap.strato.de',
  port: 993,
  email: process.env.TEST_EMAIL || 'emily@praesidion.com',
  password: process.env.TEST_PASSWORD || ''
};

async function runTest() {
  console.log('=== InboxPilot IMAP Live Test ===\n');
  const results = { steps: [], pass: true };

  function log(step, ok, detail) {
    const icon = ok ? '✅' : '❌';
    console.log(`${icon} ${step}: ${detail}`);
    results.steps.push({ step, ok, detail });
    if (!ok) results.pass = false;
  }

  // Step 1: Provider detection
  const provider = imap.detectProvider(TEST_CONFIG.email);
  const suggested = imap.suggestImapSettings(TEST_CONFIG.email);
  log('Provider detection', true, `Provider: ${provider ? provider.name : 'custom'}, suggested host: ${suggested.host}:${suggested.port}`);

  // Step 2: Save encrypted credentials
  try {
    store.initStore();
    const stored = imap.saveCredentials(TEST_LEAD_ID, TEST_CONFIG);
    log('Save credentials', true, `Encrypted & stored. ConnectedAt: ${stored.connectedAt}`);
  } catch (err) {
    log('Save credentials', false, err.message);
    return results;
  }

  // Step 3: Verify credentials can be loaded
  const loaded = imap.loadCredentials(TEST_LEAD_ID);
  if (loaded && loaded.host === TEST_CONFIG.host) {
    log('Load credentials', true, `Host: ${loaded.host}, port: ${loaded.port}, email: ${loaded.email}`);
  } else {
    log('Load credentials', false, 'Failed to load stored credentials');
    return results;
  }

  // Step 4: Verify password decryption
  try {
    const decrypted = imap.decrypt({ iv: loaded.iv, authTag: loaded.authTag, encrypted: loaded.encrypted });
    const match = decrypted === TEST_CONFIG.password;
    log('Decrypt password', match, match ? 'Password decrypts correctly' : 'Password mismatch!');
  } catch (err) {
    log('Decrypt password', false, err.message);
  }

  // Step 5: hasCredentials check
  const hasCreds = imap.hasCredentials(TEST_LEAD_ID);
  log('hasCredentials', hasCreds, `hasCredentials(${TEST_LEAD_ID}) = ${hasCreds}`);

  // Step 6: Live IMAP fetch
  console.log('\n--- Live IMAP Connection ---');
  try {
    const result = await imap.fetchLiveMessages(TEST_LEAD_ID, { maxMessages: 10 });
    log('IMAP connect + fetch', true,
      `Connected! Total in mailbox: ${result.totalInMailbox}, fetched: ${result.fetched.length}, new stored: ${result.newStored}`);

    // Step 7: Show fetched messages
    if (result.fetched.length > 0) {
      console.log('\n--- Recent Messages ---');
      for (const msg of result.fetched.slice(0, 5)) {
        console.log(`  📧 [${msg.date}] From: ${msg.fromName || msg.from} | Subject: ${msg.subject}`);
      }
      log('Messages retrieved', true, `${result.fetched.length} messages with subjects and metadata`);
    } else {
      log('Messages retrieved', true, 'Mailbox exists but is empty (0 messages)');
    }
  } catch (err) {
    log('IMAP connect + fetch', false, `${err.message} (code: ${err.code || 'unknown'})`);
  }

  // Step 8: Verify stored messages can be read back
  const stored = imap.getStoredMessages(TEST_LEAD_ID, 10);
  log('Read stored messages', true, `${stored.length} messages available from local store`);

  // Step 9: Polling status
  const status = imap.getPollingStatus(TEST_LEAD_ID);
  log('Polling status', status.status === 'connected', `Status: ${status.status}`);

  // Step 10: Engine metrics
  const metrics = imap.getEngineMetrics();
  log('Engine metrics', metrics.totalConfiguredLeads > 0,
    `${metrics.totalConfiguredLeads} configured lead(s), messages for test lead: ${metrics.leads[TEST_LEAD_ID]?.messageCount || 0}`);

  // Cleanup: remove test credentials
  imap.deleteCredentials(TEST_LEAD_ID);
  log('Cleanup', !imap.hasCredentials(TEST_LEAD_ID), 'Test credentials deleted');

  // Summary
  console.log('\n=== Test Summary ===');
  const passed = results.steps.filter(s => s.ok).length;
  const total = results.steps.length;
  console.log(`${passed}/${total} steps passed. Overall: ${results.pass ? '✅ PASS' : '❌ FAIL'}`);

  return results;
}

runTest().then(results => {
  process.exit(results.pass ? 0 : 1);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
