'use strict';

// Which app the text came from (ChatGPT, Claude, X, LinkedIn, Grok…), so the
// pill can show its logo. Browsers put the page's address on the clipboard
// with what you copy (Windows: "SourceURL:" in the HTML; Mac: Chrome's
// source-url type); copied links and posts carry their own address.

const APPS = [
  ['chatgpt', (h) => h.endsWith('chatgpt.com') || h.endsWith('openai.com')],
  ['claude', (h) => h.endsWith('claude.ai')],
  ['x', (h) => ['x.com', 'twitter.com', 'mobile.twitter.com', 'mobile.x.com'].includes(h)],
  ['linkedin', (h) => h.endsWith('linkedin.com')],
  ['grok', (h) => h.endsWith('grok.com')],
];

/** A logo name for a web address, or null. */
function appFromURL(url) {
  let host;
  try { host = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
  const match = APPS.find(([, test]) => test(host));
  return match ? match[0] : null;
}

/** A logo name for a source the pipeline names ("ChatGPT", "X", "LinkedIn"…), or null. */
function appFromSource(name) {
  const key = String(name || '').toLowerCase();
  return APPS.some(([app]) => app === key) ? key : null;
}

/** The address of the page the clipboard's text was copied from, if the browser said. */
async function clipboardSourceURL(clipboard) {
  const read = async (format) => { try { return String((await clipboard.read(format)) || ''); } catch { return ''; } };
  const html = await read('HTML Format'); // Windows: CF_HTML header
  const fromHTML = /^SourceURL:(\S+)/m.exec(html);
  if (fromHTML) return fromHTML[1];
  const chromium = (await read('org.chromium.source-url')).trim(); // Mac: Chrome, Edge, Brave, Arc
  return /^https?:\/\//.test(chromium) ? chromium : null;
}

module.exports = { appFromURL, appFromSource, clipboardSourceURL };
