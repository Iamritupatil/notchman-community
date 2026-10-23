'use strict';

// Updates for Notchman Community, which runs from its GitHub folder: "Check
// for updates" asks GitHub whether there's anything new, and "Update now"
// pulls it (git pull), installs any new packages (npm install) and restarts.
// Your .env (keys) and settings are untouched.

const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const isWindows = process.platform === 'win32';

function run(command, args, timeout = 120_000) {
  return new Promise((resolve) => {
    execFile(command, args, { cwd: ROOT, timeout, windowsHide: true, shell: isWindows, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout).trim(), err: String(stderr || error?.message || '').trim() }));
  });
}

const isCheckout = () => fs.existsSync(path.join(ROOT, '.git'));

/** { ok, available, version, current } like the paid edition's updater. */
async function check() {
  if (!isCheckout()) return { ok: false, message: 'This copy of Notchman Community isn\'t a git folder. Download it again with git clone to get updates.' };
  const fetched = await run('git', ['fetch', '--quiet', 'origin'], 30_000);
  if (!fetched.ok) return { ok: false, message: "Couldn't reach GitHub. Check your connection." };
  const [current, latest, behind] = await Promise.all([
    run('git', ['rev-parse', '--short', 'HEAD']),
    run('git', ['rev-parse', '--short', '@{u}']),
    run('git', ['rev-list', '--count', 'HEAD..@{u}']),
  ]);
  if (!current.ok || !latest.ok || !behind.ok) return { ok: false, message: "Couldn't compare with GitHub." };
  const count = Number(behind.out) || 0;
  return { ok: true, available: count > 0, version: latest.out, current: current.out, changes: count };
}

/** Pulls the new version, installs its packages and restarts Notchman. */
async function install() {
  if (!isCheckout()) return { ok: false, message: 'Download Notchman Community again with git clone to get updates.' };
  const pulled = await run('git', ['pull', '--ff-only']);
  if (!pulled.ok) {
    return { ok: false, message: 'The update needs your attention: in the Notchman folder, run git pull and npm install.' };
  }
  const installed = await run(isWindows ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], 600_000);
  if (!installed.ok) return { ok: false, message: 'The update was downloaded, but npm install failed. In the Notchman folder, run npm install.' };
  const { app } = require('electron');
  app.relaunch();
  app.exit(0);
  return { ok: true };
}

module.exports = { check, install };
