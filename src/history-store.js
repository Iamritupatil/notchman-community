'use strict';

// What you've listened to, kept on this computer (history.json in the app's
// data folder): the newest 200 TL;DRs and reads, with the text that was spoken
// so they can be replayed without asking the server again.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LIMIT = 200;
/** Long originals are trimmed: History is for finding and replaying, not archiving. */
const MAX_TEXT = 20000;

function createHistoryStore(directory) {
  const file = path.join(directory, 'history.json');
  let items = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(parsed)) items = parsed.filter((i) => i && typeof i.spoken === 'string');
  } catch { /* first run */ }

  function save() {
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(items));
    } catch { /* history is optional */ }
  }

  return {
    /** Newest first. */
    list: () => items.slice(),
    get: (id) => items.find((i) => i.id === id) || null,
    add({ action, title, source, spoken, original, highlights }) {
      // The same content listened to again moves to the top instead of repeating.
      items = items.filter((i) => !(i.action === action && i.spoken === spoken));
      const item = {
        id: crypto.randomUUID(),
        at: Date.now(),
        action,
        title: String(title || '').slice(0, 200),
        source: String(source || ''),
        spoken: String(spoken).slice(0, MAX_TEXT),
        original: original ? String(original).slice(0, MAX_TEXT) : null,
        highlights: Array.isArray(highlights) ? highlights.slice(0, 10).map((h) => String(h).slice(0, 300)) : [],
      };
      items.unshift(item);
      if (items.length > LIMIT) items.length = LIMIT;
      save();
      return item;
    },
    remove(id) {
      items = items.filter((i) => i.id !== id);
      save();
    },
    clear() {
      items = [];
      save();
    },
  };
}

module.exports = { createHistoryStore };
