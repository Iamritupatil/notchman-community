'use strict';

// Notchman from the Microsoft Store and Notchman from the website must never
// run side by side: they'd share one data folder, and the second one's
// windows hang (Chromium can't open its storage twice). So:
//  - the Store version keeps its own data folder, starting from a copy of the
//    website version's settings, history and insights (same Install ID, so the
//    plan carries over);
//  - the website version steps aside once the Store version is installed: it
//    doesn't start, and stops starting with Windows.

const fs = require('node:fs');
const path = require('node:path');

/** The Store package's family name (Partner Center → Product identity). */
const STORE_FAMILY = 'RituPatil.Notchman_jyhy2b36txn1y';
const CARRIED_OVER = ['settings.json', 'history.json', 'insights.json', 'voice-state.json'];

/** The Store version's own data folder. */
const storeDataFolder = (appData) => path.join(appData, 'Notchman Store');

/** Copies the website version's data into `to` the first time (never over data that's there). */
function carryOver(from, to) {
  if (fs.existsSync(path.join(to, 'settings.json'))) return false;
  fs.mkdirSync(to, { recursive: true });
  for (const name of CARRIED_OVER) {
    try {
      fs.copyFileSync(path.join(from, name), path.join(to, name));
    } catch { /* not there yet */ }
  }
  return true;
}

/** True once the Store version is installed for this Windows user. */
function storeVersionInstalled(localAppData) {
  return Boolean(localAppData) && fs.existsSync(path.join(localAppData, 'Packages', STORE_FAMILY));
}

module.exports = { STORE_FAMILY, storeDataFolder, carryOver, storeVersionInstalled };
