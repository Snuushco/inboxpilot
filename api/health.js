const store = require('../lib/store');
const { sendJson, handleCors } = require('../lib/response');

module.exports = function handler(req, res) {
  if (handleCors(req, res)) return;
  store.initStore();
  const status = store.readJson(store.STATUS_JSON, store.buildBaseStatus());
  return sendJson(res, 200, store.summarizeStatusForResponse(status));
};
