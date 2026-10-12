#!/usr/bin/env node
'use strict';

// Notchman Community setup, in the terminal: asks for your API keys and saves
// them to .env in this folder. The app itself never asks for keys.
//
//   npm install        runs it once (when the terminal can take input)
//   npm start          runs it first if Notchman isn't set up yet
//   npm run setup      change your keys any time
//
// Also works without it: put the keys in .env yourself (see .env.example), or
// set them as environment variables.

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const folder = path.join(__dirname, '..');
const envFile = path.join(folder, '.env');
const mode = process.argv[2] || 'setup'; // --install, --check or setup

function readEnv() {
  const values = {};
  try {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match && !line.trim().startsWith('#')) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2').trim();
    }
  } catch { /* no .env yet */ }
  return values;
}

/** Ready when there's a Groq key, or another AI provider is set in .env. */
function isSetUp() {
  const env = { ...readEnv(), ...process.env };
  return Boolean((env.GROQ_API_KEY || '').trim() || (env.LLM_BASE_URL || '').trim());
}

/** Writes the given values into .env, keeping everything else in it. */
function saveEnv(changes) {
  let lines = [];
  try { lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/); } catch {
    try { lines = fs.readFileSync(path.join(folder, '.env.example'), 'utf8').split(/\r?\n/); } catch { /* start empty */ }
  }
  for (const [name, value] of Object.entries(changes)) {
    const index = lines.findIndex((line) => new RegExp(`^\\s*#?\\s*${name}\\s*=`).test(line));
    if (index >= 0) lines[index] = `${name}=${value}`;
    else lines.push(`${name}=${value}`);
  }
  fs.writeFileSync(envFile, `${lines.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });
}

/** Asks a question; the answer isn't shown on screen (it's a key). */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let asked = false;
    rl._writeToOutput = (text) => {
      if (!asked) { process.stdout.write(text); return; }
      if (text.includes('\n')) process.stdout.write('\n');
    };
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
    asked = true;
  });
}

async function groqAccepts(key) {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    if (response.status === 401 || response.status === 403) return false;
    return true;
  } catch {
    return null; // offline: can't tell
  }
}

async function setup() {
  console.log('\nNotchman Community setup');
  console.log('Get a free Groq API key at https://console.groq.com/keys (sign in, then Create API Key).\n');
  let groq = '';
  for (;;) {
    groq = await askHidden('Groq API key (hidden while you paste, then press Enter): ');
    if (!groq) { console.log('A Groq API key is needed to make TL;DRs.'); continue; }
    const ok = await groqAccepts(groq);
    if (ok === false) { console.log("Groq didn't accept that key. Copy it again from console.groq.com/keys.\n"); continue; }
    console.log(ok ? 'Groq key works.' : "Couldn't reach Groq to check the key; saving it anyway.");
    break;
  }
  console.log('\nOptional: an ElevenLabs API key for natural voices (https://elevenlabs.io).');
  console.log('Without it, a free voice runs on your computer.');
  const eleven = await askHidden('ElevenLabs API key (or just press Enter to skip): ');
  saveEnv({ GROQ_API_KEY: groq, ...(eleven ? { ELEVENLABS_API_KEY: eleven } : {}) });
  console.log('\nSaved to .env in this folder. Change it any time with: npm run setup\n');
}

(async () => {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (mode === '--install') {
    // Never fails an install. Asks only when the terminal can answer.
    if (isSetUp()) return;
    if (interactive) await setup();
    else console.log('\nNext: npm start (it asks for your free Groq API key the first time).\n');
    return;
  }
  if (mode === '--check') {
    if (isSetUp()) return;
    if (!interactive) {
      console.error('\nNotchman isn\'t set up yet. Run "npm run setup" in this folder first.\n');
      process.exit(1);
    }
    await setup();
    return;
  }
  if (!interactive) {
    console.error('Run "npm run setup" in a terminal (it asks for your keys).');
    process.exit(1);
  }
  await setup();
})();
