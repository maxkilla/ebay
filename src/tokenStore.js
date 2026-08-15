const fs = require('fs');
const path = require('path');
const config = require('./config');

const storePath = path.resolve(process.cwd(), config.tokenStorePath);

function ensureDir() {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readAll() {
  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function writeAll(data) {
  ensureDir();
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function get(key) {
  return readAll()[key];
}

function set(key, value) {
  const data = readAll();
  data[key] = value;
  writeAll(data);
}

module.exports = { get, set };
