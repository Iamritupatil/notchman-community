'use strict';

// Works out what was copied: a link to fetch, or text to read. Plain code, no
// model call, so it costs nothing and takes no time.

const MIN_TEXT = 40;

/** A copied value that is only a link (with optional surrounding whitespace). */
function standaloneURL(raw) {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  const candidate = /^www\./i.test(value) ? `https://${value}` : value;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.')) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * @returns {{kind: 'url', url: URL} | {kind: 'text', text: string, source: string|null}
 *          | {kind: 'empty'} | {kind: 'short', text: string}}
 */
function classify(raw) {
  const value = (raw || '').trim();
  if (!value) return { kind: 'empty' };
  const url = standaloneURL(value);
  if (url) return { kind: 'url', url };
  if (value.length < MIN_TEXT) return { kind: 'short', text: value };
  if (WhatsApp.isChat(value)) return { kind: 'text', text: WhatsApp.spoken(value), source: 'WhatsApp' };
  return { kind: 'text', text: value, source: null };
}

// WhatsApp Desktop and Web copy several messages as lines like
// "[10:15 pm, 29/09/2026] Ritu: See you at 6" (the phone puts the date first).
// The brackets are dropped for listening: "Ritu: See you at 6".
const WhatsApp = {
  line: /^‎?\[[^\]\n]{4,40}\] ([^:\n]{1,60}): /gm,
  isChat(text) {
    this.line.lastIndex = 0;
    return this.line.test(text);
  },
  spoken(text) {
    return text.replace(this.line, '$1: ');
  },
};

module.exports = { classify, standaloneURL, WhatsApp, MIN_TEXT };
