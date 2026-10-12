'use strict';

// Reads the text selected in the app you're using, without a screenshot:
// it sends that app the Copy shortcut (Ctrl+C / ⌘C), reads the clipboard,
// then puts your clipboard back as it was. The Shiba's window never takes
// focus, so the shortcut goes to the app with your selection.
//
// Windows: a PowerShell process kept open in the background sends the
// keystroke (instant after the first use). Mac: System Events (macOS asks once
// for Accessibility permission).

const { spawn, execFile } = require('node:child_process');

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

let shell = null;

function windowsShell() {
  if (shell && !shell.killed && shell.exitCode === null) return shell;
  shell = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'],
    { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
  shell.stdin.write('Add-Type -AssemblyName System.Windows.Forms\n');
  shell.on('exit', () => { shell = null; });
  return shell;
}

/** Starts the helper early so the first copy is instant. */
function warmUp() {
  if (isWindows) windowsShell();
}

function sendCopyShortcut() {
  if (isWindows) {
    windowsShell().stdin.write("[System.Windows.Forms.SendKeys]::SendWait('^c')\n");
    return Promise.resolve();
  }
  if (isMac) {
    return new Promise((resolve) => {
      execFile('osascript', ['-e', 'tell application "System Events" to keystroke "c" using command down'],
        () => resolve());
    });
  }
  return Promise.resolve();
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The selected text in the frontmost app, or '' if nothing is selected (or it
 * can't be copied). The clipboard is restored afterwards.
 * @param {Electron.Clipboard} clipboard
 */
async function selectedText(clipboard) {
  if (!isWindows && !isMac) return '';
  // Newer Electron versions return clipboard reads as promises; await works for both.
  const formats = (await clipboard.availableFormats()) || [];
  const saved = formats.length ? {
    text: await clipboard.readText(),
    html: await clipboard.readHTML(),
    image: await clipboard.readImage(),
  } : null;
  await clipboard.clear();
  await sendCopyShortcut();
  let text = '';
  for (let i = 0; i < 12 && !text; i++) {
    await wait(40);
    text = String((await clipboard.readText()) || '').trim();
  }
  // Put back what was there before.
  await clipboard.clear();
  if (saved) {
    const data = {};
    if (saved.text) data.text = saved.text;
    if (saved.html) data.html = saved.html;
    if (saved.image && !saved.image.isEmpty()) data.image = saved.image;
    if (Object.keys(data).length) await clipboard.write(data);
  }
  return text;
}

module.exports = { selectedText, warmUp };
