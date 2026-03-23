/**
 * SortBox Serverless Storage Adapter
 * 
 * Uses /tmp for ephemeral file storage on Vercel.
 * Data persists within warm function instances but is lost on cold starts.
 * For MVP demo this is fine — demo data is generated on-the-fly.
 * 
 * Also provides in-memory fallback for when /tmp isn't available.
 */
const fs = require('fs');
const path = require('path');

const IS_VERCEL = !!process.env.VERCEL;
const BASE_DIR = IS_VERCEL ? '/tmp/sortbox' : path.join(__dirname, '..', 'submissions');

// In-memory store for data that must survive across API calls within same instance
const _memStore = new Map();

function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (e) {
    // ignore
  }
}

function getDataDir() {
  ensureDir(BASE_DIR);
  return BASE_DIR;
}

function getSubDir(name) {
  const dir = path.join(BASE_DIR, name);
  ensureDir(dir);
  return dir;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function appendLine(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

function readFile(filePath, fallback) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return fallback || '';
  }
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

// Memory store operations (for data that must persist across API calls in warm instance)
function memGet(key, fallback) {
  return _memStore.has(key) ? _memStore.get(key) : fallback;
}

function memSet(key, value) {
  _memStore.set(key, value);
}

function memDel(key) {
  _memStore.delete(key);
}

module.exports = {
  IS_VERCEL,
  BASE_DIR,
  getDataDir,
  getSubDir,
  readJson,
  writeJson,
  appendLine,
  readFile,
  writeFile,
  fileExists,
  ensureDir,
  memGet,
  memSet,
  memDel
};
