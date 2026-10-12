'use strict';

// Preferences and the install ID, in a JSON file in the app's data folder.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { defaults } = require('./config');

function createSettingsStore(directory) {
  const file = path.join(directory, 'settings.json');
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* first run */ }
  data = { ...defaults, ...data };
  if (!/^[0-9a-f-]{36}$/i.test(data.installId || '')) data.installId = crypto.randomUUID();
  const isFirstRun = !data.welcomed;
  save();

  function save() {
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch { /* settings are a convenience; never block listening */ }
  }

  return {
    isFirstRun,
    get: (key) => data[key],
    all: () => ({ ...data }),
    set(changes) {
      data = { ...data, ...changes };
      save();
      return { ...data };
    },
  };
}

module.exports = { createSettingsStore };
