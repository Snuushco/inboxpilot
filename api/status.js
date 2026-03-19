const store = require('../lib/store');
const { sendJson, handleCors } = require('../lib/response');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  store.initStore();
  const status = store.readJson(store.STATUS_JSON, store.buildBaseStatus());
  const latest = store.readJson(store.LATEST_JSON, { ok: true, latest: null });
  return sendJson(res, 200, {
    ok: true,
    status: store.summarizeStatusForResponse(status),
    latest: { ok: true, latest: store.redactLead(latest.latest || null) }
  });
};
