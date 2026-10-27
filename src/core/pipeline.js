'use strict';

// Copied value → what to say. The requested action (TL;DR or Read) travels
// through every step, so fetched content never switches to the other one.
//
//   text ─────────────────────────┐
//   link → fetch the post/article ┴→ TL;DR: one summary call → speak the summary
//                                    Read:  speak the original (cleaned)

const crypto = require('node:crypto');
const { classify } = require('./input');
const { clean, split } = require('./speech-text');
const { sourceName } = require('./links');

const ACTIONS = new Set(['tldr', 'read']);

class NothingToRead extends Error {}

function hash(value) {
  return crypto.createHash('sha256').update(value.replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex').slice(0, 32);
}

/**
 * @param {object} deps
 * @param {(url: URL) => Promise<{text, title, source, url}>} deps.resolve
 * @param {(text: string) => Promise<string | {summary: string, highlights?: string[]}>} deps.summarize
 * @param {Map<string, object>} [deps.cache] results by copied value + action
 * @param {() => string} [deps.variant] what else makes a TL;DR different (its language)
 */
function createPipeline({ resolve, summarize, cache = new Map(), variant = () => '' }) {
  /**
   * @param {string} copied what's on the clipboard
   * @param {'tldr'|'read'} action
   * @param {(stage: string) => void} [onStage] 'fetching' | 'summarizing'
   * @returns {Promise<{action, title, source, original, spoken, pieces, fromCache, key}>}
   */
  async function prepare(copied, action, onStage = () => {}, { source: sourceOverride } = {}) {
    if (!ACTIONS.has(action)) throw new Error(`Unknown action ${action}`);
    const input = classify(copied);
    if (input.kind === 'empty') throw new NothingToRead('Copy a message or link first, then press the shortcut.');
    if (input.kind === 'short') throw new NothingToRead("That's too short to read. Copy the whole message.");

    // A second press on the same content doesn't fetch or summarize again.
    const key = `${action}:${action === 'tldr' ? variant() : ''}:${hash(copied)}`;
    if (cache.has(key)) return { ...cache.get(key), fromCache: true };

    let original;
    let title = null;
    let source;
    if (input.kind === 'url') {
      onStage('fetching');
      const page = await resolve(input.url);
      original = page.text;
      title = page.title;
      source = page.source || sourceName(input.url);
    } else {
      original = input.text;
      source = input.source || sourceOverride || 'Copied text';
    }

    let spoken;
    let highlights = [];
    if (action === 'tldr') {
      onStage('summarizing');
      const made = await summarize(clean(original));
      spoken = clean(typeof made === 'string' ? made : made.summary);
      // The key points, for History (the Notchman server sends them; other summarizers may not).
      if (made && Array.isArray(made.highlights)) highlights = made.highlights.map((h) => String(h).trim()).filter(Boolean).slice(0, 10);
    } else {
      spoken = clean(original);
    }
    if (!title) title = firstLine(original);

    const result = { action, title, source, original, spoken, highlights, pieces: split(spoken), key, contentHash: hash(copied) };
    cache.set(key, result);
    if (cache.size > 50) cache.delete(cache.keys().next().value);
    return { ...result, fromCache: false };
  }

  return { prepare };
}

function firstLine(text) {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 3) || 'Copied text';
  return line.length > 60 ? `${line.slice(0, 57).replace(/\s+\S*$/, '')}…` : line;
}

module.exports = { createPipeline, NothingToRead, hash };
