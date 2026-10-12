'use strict';

// The Community edition's own pieces: your API keys and the direct client.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createKeyStore, readDotEnv } = require('../src/key-store');
const { createClient, ApiError, wordLimit } = require('../src/core/byok');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'notchman-keys-'));

test('keys come from the environment, then .env, then Settings; values are never described', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.env'), '# comment\nGROQ_API_KEY="gsk_from_env_file"\nELEVENLABS_API_KEY=el_file\n');
  const keys = createKeyStore({ directory: dir, dotEnv: path.join(dir, '.env'), env: { ELEVENLABS_API_KEY: 'el_env' } });
  assert.equal(keys.get('GROQ_API_KEY'), 'gsk_from_env_file');
  assert.equal(keys.get('ELEVENLABS_API_KEY'), 'el_env');
  keys.set('LLM_MODEL', 'llama3.1');
  const described = keys.describe();
  assert.deepEqual([described.GROQ_API_KEY, described.ELEVENLABS_API_KEY, described.LLM_MODEL], ['.env file', 'environment', 'saved']);
  assert.ok(!JSON.stringify(described).includes('gsk_from_env_file'));
  // Saved keys survive a restart.
  assert.equal(createKeyStore({ directory: dir, env: {} }).get('LLM_MODEL'), 'llama3.1');
  assert.deepEqual(readDotEnv(path.join(dir, 'missing')), {});
});

test('a TL;DR goes straight to Groq with your key', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'The short version.' } }] }));
  };
  const keys = createKeyStore({ directory: tmp(), env: { GROQ_API_KEY: 'gsk_test' } });
  const client = createClient({ keys, fetch });
  assert.equal(client.ready(), true);
  assert.equal(await client.tldr('Lunch moved to Friday at one. Bring the slides and the budget numbers.'), 'The short version.');
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer gsk_test');
  assert.equal(JSON.parse(calls[0].init.body).model, 'llama-3.3-70b-versatile');
});

test('without a key, or with a wrong one, the message says what to do', async () => {
  const none = createClient({ keys: createKeyStore({ directory: tmp(), env: {} }), fetch: async () => { throw new Error('no call'); } });
  assert.equal(none.ready(), false);
  await assert.rejects(none.tldr('text'), (e) => e instanceof ApiError && /Groq API key in Settings/.test(e.message));
  const wrong = createClient({
    keys: createKeyStore({ directory: tmp(), env: { GROQ_API_KEY: 'bad' } }),
    fetch: async () => new Response('{}', { status: 401 }),
  });
  await assert.rejects(wrong.tldr('text'), /didn't accept your API key/);
  await assert.rejects(none.speak({ text: 'hi', voiceId: 'x' }), /ElevenLabs API key/);
  assert.equal(none.hasCloudVoice(), false);
});

test('a local OpenAI-compatible model needs no key', async () => {
  const calls = [];
  const keys = createKeyStore({ directory: tmp(), env: { LLM_BASE_URL: 'http://localhost:11434/v1/', LLM_MODEL: 'llama3.1' } });
  const client = createClient({
    keys,
    fetch: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })); },
  });
  assert.equal(client.ready(), true);
  assert.equal(await client.tldr('Some text worth a summary, long enough to matter.'), 'ok');
  assert.equal(calls[0].url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test('TL;DR length follows the text: a third of it, between 40 and 120 words', () => {
  assert.equal(wordLimit('word '.repeat(30)), 40);
  assert.equal(wordLimit('word '.repeat(300)), 100);
  assert.equal(wordLimit('word '.repeat(3000)), 120);
});
