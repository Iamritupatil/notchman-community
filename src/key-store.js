'use strict';

// Your own API keys (Community edition). Looked up in this order:
//  1. environment variables (GROQ_API_KEY, ELEVENLABS_API_KEY, ...)
//  2. a .env file next to package.json (handy when running from source)
//  3. keys saved from Settings, encrypted with the operating system's key store
// Keys never leave this computer except in requests to the provider they belong to.

const fs = require('node:fs');
const path = require('node:path');

const NAMES = ['GROQ_API_KEY', 'ELEVENLABS_API_KEY', 'LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'];

function readDotEnv(file) {
  const values = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match || line.trim().startsWith('#')) continue;
      values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2').trim();
    }
  } catch { /* no .env */ }
  return values;
}

/**
 * @param {{ directory: string, dotEnv?: string, safeStorage?: Electron.SafeStorage, env?: NodeJS.ProcessEnv }} options
 */
function createKeyStore({ directory, dotEnv, safeStorage, env = process.env }) {
  const file = path.join(directory, 'keys.json');
  const fromFile = dotEnv ? readDotEnv(dotEnv) : {};
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* none saved */ }

  const encrypted = () => Boolean(safeStorage?.isEncryptionAvailable());

  function decode(value) {
    if (typeof value !== 'string' || !value) return '';
    if (value.startsWith('enc:')) {
      try { return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64')); } catch { return ''; }
    }
    return value.startsWith('raw:') ? value.slice(4) : '';
  }

  function get(name) {
    return (env[name] || fromFile[name] || decode(saved[name]) || '').trim();
  }

  function set(name, value) {
    if (!NAMES.includes(name)) throw new Error(`Unknown key ${name}`);
    const clean = String(value || '').trim();
    if (!clean) delete saved[name];
    else saved[name] = encrypted() ? `enc:${safeStorage.encryptString(clean).toString('base64')}` : `raw:${clean}`;
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
  }

  /** Where each key comes from, never its value: for Settings. */
  function describe() {
    return Object.fromEntries(NAMES.map((name) => [name,
      env[name] ? 'environment' : fromFile[name] ? '.env file' : decode(saved[name]) ? 'saved' : null]));
  }

  return { get, set, has: (name) => Boolean(get(name)), describe };
}

module.exports = { createKeyStore, readDotEnv };
