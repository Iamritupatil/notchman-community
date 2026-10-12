'use strict';

// Your own API keys (Community edition). Set outside the app, on purpose:
//  1. environment variables (GROQ_API_KEY, ELEVENLABS_API_KEY, ...)
//  2. a .env file next to package.json (read again on every use, so editing
//     it needs no restart)
// There's no way to paste keys into the app itself; the README shows how to
// set them. Keys never leave this computer except in requests to the
// provider they belong to.

const fs = require('node:fs');

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
 * @param {{ dotEnv?: string, env?: NodeJS.ProcessEnv }} options
 */
function createKeyStore({ dotEnv, env = process.env }) {
  const fromFile = () => (dotEnv ? readDotEnv(dotEnv) : {});

  function get(name) {
    return (env[name] || fromFile()[name] || '').trim();
  }

  /** Where each key comes from, never its value: for Settings. */
  function describe() {
    const file = fromFile();
    return Object.fromEntries(NAMES.map((name) => [name,
      env[name]?.trim() ? 'environment' : file[name]?.trim() ? '.env file' : null]));
  }

  return { get, has: (name) => Boolean(get(name)), describe };
}

module.exports = { createKeyStore, readDotEnv };
