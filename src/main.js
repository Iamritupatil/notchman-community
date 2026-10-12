'use strict';

// Notchman for Windows and Mac.
//
// Two ways in:
//  - The floating Shiba: drag it anywhere; click it, choose TL;DR or Read, and
//    every paragraph on screen gets a liquid-glass outline. Click one (or
//    several) and it plays.
//  - Copy anything (a message, an answer, a link) and press Alt+T (TL;DR) or
//    Alt+R (Read).
// The TL;DR plays from a small pill at the top of the screen; the app you're
// in keeps focus. Notchman also lives in the tray / menu bar.

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const {
  app, BrowserWindow, Tray, Menu, clipboard, globalShortcut, ipcMain, screen, nativeImage, shell, Notification, desktopCapturer,
} = require('electron');
const config = require('./config');

// A failure in a background helper (text recognition, a voice request) must
// never pop up Electron's "JavaScript error" dialog: log it and keep running.
process.on('uncaughtException', (error) => console.error('uncaught', error));
process.on('unhandledRejection', (error) => console.error('unhandled', error));
const { createSettingsStore } = require('./settings-store');
const edition = require('./edition');
const { createKeyStore } = require('./key-store');
const { createPipeline, NothingToRead, hash } = require('./core/pipeline');
const { split } = require('./core/speech-text');
const { createHistoryStore } = require('./history-store');
const links = require('./core/links');
const { standaloneURL } = require('./core/input');
const localVoice = require('./local-voice');
const selection = require('./selection');
// Pro only: these aren't part of the public Community edition.
const pro = (name) => (edition.community ? null : require(name));
const screenReader = pro('./screen-reader');
// From the Microsoft Store, the Store installs updates (and Windows signs the app).
const storeApp = Boolean(process.windowsStore);
const updater = storeApp ? null : pro('./updater');
const proClient = pro('./core/api');
const proDevice = pro('./device-id');
const proParagraphs = pro('./core/paragraphs');
const PRO_URL = 'https://notchman.app';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openSettings());
}

const isMac = process.platform === 'darwin';
const asset = (name) => path.join(__dirname, '..', 'assets', name);
// Run from a downloaded folder (npm start), not installed: the Community edition from GitHub.
const runFromSource = Boolean(process.defaultApp);
// A Mac login item can't pass the folder to Electron, so that one can't start at
// sign-in; a Store app starts through its startup task (Windows Settings → Apps → Startup).
const canOpenAtLogin = !(isMac && runFromSource) && !storeApp;

/** Starts Notchman when you sign in (or stops). From a folder, Electron is told which app to open. */
function setOpenAtLogin(on) {
  if (!canOpenAtLogin) return;
  app.setLoginItemSettings(runFromSource
    ? { openAtLogin: Boolean(on), path: process.execPath, args: [app.getAppPath()] }
    : { openAtLogin: Boolean(on) });
}

let settings;
let history;
let dashboard = null;
let updateAvailable = null;
let api;
let keys = null; // Community edition: your own API keys
let pipeline;
let tray = null;
let pill = null;
let pillReady = Promise.resolve();
let buddy = null;
let trayMenu = null;
let picker = null;

// What's loaded in the pill: one "session" per press.
let session = null;
let sessionCounter = 0;
const audioCache = new Map(); // `${voiceId}:${hash(piece)}` → Buffer
let voiceDirectory;

// ---------------------------------------------------------------------------
// Startup

// `--self-test=<png> --self-test-out=<file>`: checks screen reading (both
// recognizers) and the computer voice inside the packaged app, writes the
// results to the file and quits. CI runs it on the built Windows and Mac apps.
const selfTestArg = process.argv.find((a) => a.startsWith('--self-test='));

async function runSelfTest() {
  const outArg = process.argv.find((a) => a.startsWith('--self-test-out='));
  const out = outArg ? outArg.slice('--self-test-out='.length) : path.join(app.getPath('temp'), 'notchman-self-test.txt');
  const lines = [];
  const log = (line) => { lines.push(line); fs.writeFileSync(out, lines.join('\n')); };
  const step = async (name, fn) => {
    const started = Date.now();
    try {
      log(`${name}: ok ${await fn()} (${Date.now() - started} ms)`);
    } catch (error) {
      log(`${name}: FAILED ${error?.stack || error} (${Date.now() - started} ms)`);
    }
  };
  log(`version ${app.getVersion()} ${process.platform} ${process.arch}`);
  const image = nativeImage.createFromPath(selfTestArg.slice('--self-test='.length));
  const cache = path.join(app.getPath('userData'), 'ocr');
  if (screenReader) {
    await step('built-in OCR', async () => (await screenReader.findParagraphs(image, 1, cache)).length + ' paragraphs');
    await step('Tesseract OCR', async () => (await screenReader.findParagraphs(image, 1, cache, { native: false })).length + ' paragraphs');
  }
  await step('Kokoro voice', async () => (await localVoice.speak('Notchman reads your copied post out loud.')).length + ' bytes');
  if (updater) {
    await step('update check', async () => {
      const info = await updater.check({ force: true });
      if (!info.ok) throw new Error('the downloads site did not answer');
      return `latest ${info.version}`;
    });
  }
  log('done');
  app.exit(0);
}

app.whenReady().then(() => {
  if (selfTestArg) return runSelfTest();
  // A new version downloaded earlier installs now, before anything opens.
  if (updater?.installPendingAtStart()) return;
  if (isMac) app.dock?.hide();
  settings = createSettingsStore(app.getPath('userData'));
  history = createHistoryStore(app.getPath('userData'));
  voiceDirectory = path.join(app.getPath('userData'), 'voice');
  if (edition.community) {
    // Keys are set up in the terminal (npm run setup → .env), never in the app.
    keys = createKeyStore({ dotEnv: path.join(__dirname, '..', '.env') });
    api = require('./core/byok').createClient({ keys });
  } else {
    api = proClient.createClient({ baseURL: config.apiURL, installId: settings.get('installId'), deviceId: proDevice.deviceId() });
  }
  // The paid edition says hello once a day so installs can be counted
  // (anonymous: the install ID, version and platform). Community doesn't.
  const sayHello = () => api.hello?.({ platform: process.platform, arch: process.arch, version: app.getVersion() }).catch(() => {});
  setTimeout(sayHello, 10_000);
  setInterval(sayHello, 24 * 3600_000);
  pipeline = createPipeline({
    resolve: (url) => links.resolve(url, { render: renderPage }),
    summarize: (text) => api.tldr(text),
  });

  createTray();
  createPill();
  if (screenReader) createPicker();
  if (settings.get('showBuddy') !== false) createBuddy();
  // Look for a new version shortly after start, then every 6 hours.
  // On Windows it downloads in the background and installs itself the next
  // time Notchman starts (or right away from "Restart to update").
  const lookForUpdate = async () => {
    const info = await updater.check({ force: true });
    if (!info.available || info.version === updateAvailable) return;
    const ready = await updater.download(info);
    updateAvailable = info.version;
    if (tray) tray.setContextMenu(trayMenu());
    if (Notification.isSupported()) {
      const note = new Notification({
        title: 'Notchman update',
        body: ready
          ? `Version ${info.version} installs by itself next time Notchman starts. Click to restart now.`
          : `Version ${info.version} is ready. Click to update.`,
      });
      note.on('click', () => (ready ? updater.install() : openDashboard('about')));
      note.show();
    }
  };
  if (updater) {
    setTimeout(lookForUpdate, 30_000);
    setInterval(lookForUpdate, 6 * 3600_000);
  }
  for (const change of ['display-metrics-changed', 'display-added', 'display-removed']) {
    screen.on(change, () => setTimeout(reviveBuddy, 500));
  }
  registerShortcuts();
  setOpenAtLogin(settings.get('openAtLogin'));
  // Start the text recognizer in the background so the first pick is quick.
  screenReader?.warmUp(path.join(app.getPath('userData'), 'ocr'));
  selection.warmUp();

  // Everyone agrees to the Terms and Privacy Policy before first use.
  if (hasAgreed()) welcome();
  else openAgreement();
});

function welcome() {
  if (edition.community && !api.ready()) {
    // Community edition that skipped the terminal setup (npm start runs it).
    showMessage('Notchman isn\'t set up yet. In its folder, run: npm run setup', 15000);
  } else if (settings.isFirstRun && !settings.get('welcomed')) {
    settings.set({ welcomed: true });
    // The first thing a new user sees is how to use it, not a setup flow.
    showMessage(`Select text anywhere and press ${pretty(settings.get('tldrShortcut'))}, or click the Shiba.`, 10000);
  }
}

// ---------------------------------------------------------------------------
// The agreement (Terms of Service and Privacy Policy). Bump TERMS_VERSION, the
// documents' date, when either changes materially: everyone is asked again.

const TERMS_VERSION = '2026-10-10';
let agreeWindow = null;

function hasAgreed() {
  return settings?.get('termsAccepted') === TERMS_VERSION;
}

function openAgreement() {
  if (agreeWindow) {
    agreeWindow.show();
    agreeWindow.focus();
    return;
  }
  agreeWindow = new BrowserWindow({
    width: 460,
    height: 640,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Welcome to Notchman',
    icon: asset('icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#b9def9',
    webPreferences: { preload: path.join(__dirname, 'ui', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  agreeWindow.loadFile(path.join(__dirname, 'ui', 'agree.html'));
  agreeWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  agreeWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  agreeWindow.on('closed', () => { agreeWindow = null; });
}

ipcMain.handle('agree:info', () => ({ community: Boolean(edition.community) }));
ipcMain.handle('agree:accept', () => {
  settings.set({ termsAccepted: TERMS_VERSION, termsAcceptedAt: new Date().toISOString() });
  agreeWindow?.close();
  welcome();
});
ipcMain.on('agree:quit', () => app.quit());
ipcMain.on('open-link', (_event, url) => {
  if (/^https:\/\/notchman\.app\//.test(url)) shell.openExternal(url);
});

app.on('window-all-closed', (event) => event.preventDefault()); // keep running in the tray
app.on('will-quit', () => globalShortcut.unregisterAll());

// ---------------------------------------------------------------------------
// Shortcuts

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const [action, key] of [['tldr', settings.get('tldrShortcut')], ['read', settings.get('readShortcut')]]) {
    const ok = key && globalShortcut.register(key, () => run(action));
    if (!ok) failed.push(pretty(key));
  }
  if (failed.length) {
    showMessage(`${failed.join(' and ')} is used by another app. Pick a different shortcut in Settings.`, 9000);
  }
}

function pretty(accelerator) {
  if (!accelerator) return '';
  return accelerator
    .replace('CommandOrControl', isMac ? '⌘' : 'Ctrl')
    .replace('Alt', isMac ? '⌥' : 'Alt')
    .replace('Shift', isMac ? '⇧' : 'Shift')
    .replace(/\+/g, isMac ? '' : '+');
}

// ---------------------------------------------------------------------------
// The flow: clipboard → (fetch) → (summarize) → voice → play

async function run(action, copiedOverride, { source } = {}) {
  if (!hasAgreed()) {
    openAgreement();
    return;
  }
  const copied = copiedOverride ?? await readClipboard();
  const id = ++sessionCounter;
  session = { id, action, pieces: [], original: null };
  showPill();
  sendState({ kind: 'working', id, action, status: 'Getting content…' });
  buddyState({ busy: true, speaking: false });

  try {
    const prepared = await pipeline.prepare(copied, action, (stage) => {
      if (id !== session?.id) return;
      const url = standaloneURL(copied);
      const status = stage === 'fetching'
        ? (url && links.isPostSource(links.sourceName(url)) ? 'Fetching post…' : 'Fetching page…')
        : 'Summarizing…';
      sendState({ kind: 'working', id, action, status });
    }, { source });
    if (id !== session?.id) return; // a newer press replaced this one
    startPlayback(id, action, prepared);
    history?.add({ action, title: prepared.title, source: prepared.source, spoken: prepared.spoken, original: prepared.original, highlights: prepared.highlights });
    dashboard?.webContents.send('dashboard:changed');
  } catch (error) {
    if (id !== session?.id) return;
    buddyState({ busy: false, speaking: false });
    sendState({ kind: 'error', id, message: friendly(error) });
  }
}

/** Plays prepared text (just made, or from History). */
function startPlayback(id, action, prepared) {
  const pieces = usingLocalVoice() || action === 'read' ? smallPieces(prepared.spoken) : (prepared.pieces || split(prepared.spoken));
  session = { id, action, pieces, original: prepared.original, source: prepared.source, title: prepared.title };
  sendState({ kind: 'working', id, action, status: 'Generating voice…', title: prepared.title, source: prepared.source });
  sendState({
    kind: 'play', id, action, title: prepared.title, source: prepared.source,
    pieceCount: pieces.length, speed: settings.get('speed'), canReadOriginal: action === 'tldr' && Boolean(prepared.original),
    // Listening times at ~150 words a minute, so the time saved is visible.
    spokenWords: wordCount(prepared.spoken), originalWords: wordCount(prepared.original || prepared.spoken),
  });
  buddyState({ busy: false, speaking: true });
}

/** Replays a History item: no new summary, and voice pieces already made are reused. */
function replay(itemId) {
  const item = history?.get(itemId);
  if (!item) return;
  const id = ++sessionCounter;
  showPill();
  startPlayback(id, item.action, { title: item.title, source: item.source, spoken: item.spoken, original: item.original });
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function friendly(error) {
  if (error instanceof NothingToRead || error instanceof links.LinkError) return error.message;
  if (error && error.name === 'ApiError') return error.message;
  return "Couldn't do that. Check your connection.";
}

/** What's on the clipboard: plain text, or the text of copied HTML. */
async function readClipboard() {
  // Newer Electron versions return clipboard reads as promises.
  const text = await clipboard.readText();
  if (typeof text === 'string' && text.trim()) return text;
  const html = await clipboard.readHTML();
  if (typeof html === 'string' && html) return html.replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
  return '';
}

/** Audio for one piece, voiced with its neighbours as context; cached on disk. */
async function pieceAudio(id, index) {
  if (!session || session.id !== id) return null;
  const pieces = session.pieces;
  const text = pieces[index];
  if (!text) return null;
  const voiceId = settings.get('voiceId');
  const key = `${voiceId}-${hash(text)}`;
  if (audioCache.has(key)) return audioCache.get(key);
  const file = path.join(voiceDirectory, `${key}.mp3`);
  try {
    const saved = fs.readFileSync(file);
    audioCache.set(key, saved);
    return saved;
  } catch { /* not saved yet */ }
  const audio = await api.speak({
    text, voiceId, previousText: pieces[index - 1], nextText: pieces[index + 1],
  });
  audioCache.set(key, audio);
  if (audioCache.size > 200) audioCache.delete(audioCache.keys().next().value);
  try {
    fs.mkdirSync(voiceDirectory, { recursive: true });
    fs.writeFileSync(file, audio);
  } catch { /* cache is optional */ }
  return audio;
}

/** Loads a page in a hidden browser window, for pages built with JavaScript. */
async function renderPage(url) {
  const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { offscreen: true, javascript: true, partition: 'render' } });
  try {
    await Promise.race([win.loadURL(url), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000))]);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return await win.webContents.executeJavaScript('document.documentElement.outerHTML');
  } finally {
    win.destroy();
  }
}

// ---------------------------------------------------------------------------
// The pill

const PILL = { width: 580, height: 72 };

function createPill() {
  pill = new BrowserWindow({
    width: PILL.width,
    height: PILL.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    // The app you're in keeps focus: the pill never takes the keyboard.
    focusable: false,
    alwaysOnTop: true,
    ...(isMac ? { type: 'panel' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'ui', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  pill.setAlwaysOnTop(true, 'screen-saver');
  if (isMac) pill.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Clicks go through the pill's window except while the mouse is over the
  // pill itself (the page says when). The Shiba takes clicks the same way.
  pill.setIgnoreMouseEvents(true, { forward: true });
  pillReady = new Promise((resolve) => pill.webContents.once('did-finish-load', resolve));
  pill.loadFile(path.join(__dirname, 'ui', 'pill.html'));
}

function showPill() {
  if (!pill) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width } = display.bounds;
  pill.setBounds({ x: Math.round(x + (width - PILL.width) / 2), y: y + (isMac ? 4 : 8), ...PILL });
  pill.showInactive();
}

function hidePill() {
  if (!pill) return;
  pill.hide();
  pill.setIgnoreMouseEvents(true, { forward: true });
}

function sendState(state) {
  // States sent before the pill has loaded (the first-run welcome) wait for it.
  pillReady.then(() => pill?.webContents.send('state', state));
}

function showMessage(message, ms = 5000) {
  showPill();
  sendState({ kind: 'message', id: ++sessionCounter, message, hideAfter: ms });
}

// Voices, best first: the cloud voice (ElevenLabs), then Kokoro, a free open
// voice that runs on this computer, then the system voice (read by the pill).
// For a while after the cloud voice fails, pieces skip it.
const CLOUD_VOICE_RETRY_MS = 30 * 60 * 1000;
const voiceStateFile = () => path.join(app.getPath('userData'), 'voice-state.json');
let cloudVoiceFailedAt = (() => {
  try { return Number(JSON.parse(fs.readFileSync(voiceStateFile(), 'utf8')).cloudVoiceFailedAt) || 0; } catch { return 0; }
})();
function markCloudVoiceFailed() {
  cloudVoiceFailedAt = Date.now();
  try { fs.writeFileSync(voiceStateFile(), JSON.stringify({ cloudVoiceFailedAt })); } catch { /* optional */ }
}
const usingLocalVoice = () => (api?.community && !api.hasCloudVoice()) || Date.now() - cloudVoiceFailedAt < CLOUD_VOICE_RETRY_MS;

/**
 * Pieces for the computer voice: a sentence or two each (the first one short),
 * so speech starts within seconds and the next piece is made while one plays.
 */
function smallPieces(text) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
  const pieces = [];
  let current = '';
  for (const { segment } of segmenter.segment(text)) {
    const limit = pieces.length === 0 ? 90 : 240;
    if (current && current.length + segment.length > limit) {
      pieces.push(current.trim());
      current = '';
    }
    current += segment;
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces.filter(Boolean);
}
const kokoroCache = new Map(); // hash(piece) → WAV Buffer

async function kokoroAudio(text) {
  const key = hash(text);
  if (kokoroCache.has(key)) return kokoroCache.get(key);
  const audio = await localVoice.speak(text);
  kokoroCache.set(key, audio);
  if (kokoroCache.size > 100) kokoroCache.delete(kokoroCache.keys().next().value);
  return audio;
}

ipcMain.handle('piece', async (_event, id, index) => {
  const text = session?.id === id ? session.pieces[index] : null;
  if (!text) return null;
  // Full reads are long: they use the free voice so the cloud voice's credits
  // go to TL;DRs.
  if (!usingLocalVoice() && session.action !== 'read') {
    try {
      return { audio: await pieceAudio(id, index), type: 'audio/mpeg' };
    } catch (error) {
      console.error('cloud voice failed, using the computer voice', error);
      markCloudVoiceFailed();
    }
  }
  try {
    return { audio: await kokoroAudio(text), type: 'audio/wav' };
  } catch (error) {
    console.error('Kokoro failed, using the system voice', error);
    return { speak: text };
  }
});

ipcMain.on('control', (_event, command) => {
  switch (command) {
    case 'hit':
      pill?.setIgnoreMouseEvents(false);
      break;
    case 'miss':
      pill?.setIgnoreMouseEvents(true, { forward: true });
      break;
    case 'hide':
      hidePill();
      buddyState({ speaking: false, busy: false });
      break;
    case 'stop':
      session = null;
      hidePill();
      buddyState({ speaking: false, busy: false });
      break;
    case 'original':
      // The full original, from what's already fetched: no new download.
      if (session?.original) run('read', session.original);
      break;
    case 'settings':
      openSettings();
      break;
    default:
      break;
  }
});

// ---------------------------------------------------------------------------
// The floating Shiba

const BUDDY = { width: 88, height: 82, menuWidth: 206, openHeight: 140 };
let buddyOpen = false;
let buddyCloseTimer = null;
let buddyLook = { busy: false, speaking: false, valign: 'center', community: edition.community };
let dragTimer = null;

function createBuddy() {
  const saved = settings.get('buddyPosition');
  const area = screen.getPrimaryDisplay().workArea;
  const start = saved && screen.getAllDisplays().some((d) => inside(saved, d.workArea))
    ? saved
    : { x: area.x + area.width - BUDDY.width - 24, y: area.y + Math.round(area.height * 0.62) };
  buddy = new BrowserWindow({
    x: start.x, y: start.y, width: BUDDY.width, height: BUDDY.height,
    frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
    // Clicking the Shiba doesn't take focus from the app you're in.
    focusable: false,
    ...(isMac ? { type: 'panel' } : {}),
    webPreferences: { preload: path.join(__dirname, 'ui', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  buddy.setAlwaysOnTop(true, 'screen-saver');
  if (isMac) buddy.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  buddy.loadFile(path.join(__dirname, 'ui', 'buddy.html'));
  // Clicks pass through the window except on the Shiba and its buttons (the
  // page tells us when the mouse is over them), so the empty space around
  // the Shiba never blocks the app underneath.
  buddy.setIgnoreMouseEvents(true, { forward: true });
  buddy.once('ready-to-show', () => buddy.showInactive());
  buddy.webContents.once('did-finish-load', () => buddyState({}));
  buddy.on('closed', () => { buddy = null; });
  // Right after sign-in the screens and taskbar are still settling: check again.
  for (const delay of [3000, 10000, 30000]) setTimeout(reviveBuddy, delay);
}

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

/** Puts the Shiba fully back on a screen (after a drag, or when displays change). */
function keepBuddyOnScreen() {
  if (!buddy || buddyOpen) return;
  const b = buddy.getBounds();
  const area = screen.getDisplayNearestPoint({ x: b.x + Math.round(b.width / 2), y: b.y + Math.round(b.height / 2) }).workArea;
  const x = clamp(b.x, area.x, area.x + area.width - BUDDY.width);
  const y = clamp(b.y, area.y, area.y + area.height - BUDDY.height);
  if (x !== b.x || y !== b.y || b.width !== BUDDY.width || b.height !== BUDDY.height) {
    buddy.setBounds({ x, y, width: BUDDY.width, height: BUDDY.height });
  }
}

/** Shows the Shiba again and on top (Windows can reorder windows while it starts up). */
function reviveBuddy() {
  if (!buddy) return;
  keepBuddyOnScreen();
  buddy.setAlwaysOnTop(true, 'screen-saver');
  if (!buddy.isVisible()) buddy.showInactive();
}

function inside(point, rect) {
  return point.x >= rect.x - 40 && point.y >= rect.y - 40 && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

/** Where the Shiba itself is (the window grows sideways when the menu opens). */
function shibaPosition() {
  const b = buddy.getBounds();
  if (!buddyOpen) return { x: b.x, y: b.y };
  const extra = BUDDY.openHeight - BUDDY.height;
  const dy = buddyLook.valign === 'top' ? 0 : buddyLook.valign === 'bottom' ? extra : Math.round(extra / 2);
  return { x: buddyLook.side === 'left' ? b.x + b.width - BUDDY.width : b.x, y: b.y + dy };
}

function setBuddyOpen(open) {
  if (!buddy) return;
  const shiba = shibaPosition();
  buddyOpen = open;
  if (open) {
    const area = screen.getDisplayNearestPoint(shiba).workArea;
    const roomRight = area.x + area.width - (shiba.x + BUDDY.width);
    const side = roomRight >= BUDDY.menuWidth + 8 ? 'right' : 'left';
    const width = BUDDY.width + BUDDY.menuWidth;
    // The Shiba stays exactly where it is; the menu is centred on it, or
    // aligned to its top / bottom near a screen edge, so nothing goes off screen.
    const extra = BUDDY.openHeight - BUDDY.height;
    let y = shiba.y - Math.round(extra / 2);
    let valign = 'center';
    if (y < area.y) { y = shiba.y; valign = 'top'; }
    else if (y + BUDDY.openHeight > area.y + area.height) { y = shiba.y - extra; valign = 'bottom'; }
    // In a corner (or half off screen), slide the whole thing in so every
    // button is on screen.
    y = clamp(y, area.y, area.y + area.height - BUDDY.openHeight);
    const x = clamp(side === 'right' ? shiba.x : shiba.x - BUDDY.menuWidth, area.x, area.x + area.width - width);
    buddy.setBounds({ x, y, width, height: BUDDY.openHeight });
    buddyLook.side = side;
    buddyLook.valign = valign;
  } else {
    buddy.setBounds({ x: shiba.x, y: shiba.y, width: BUDDY.width, height: BUDDY.height });
    buddyLook.side = 'right';
    buddyLook.valign = 'center';
  }
  buddyState({});
}

function buddyState(changes) {
  buddyLook = { ...buddyLook, ...changes };
  const keys = settings ? { tldr: pretty(settings.get('tldrShortcut')), read: pretty(settings.get('readShortcut')) } : null;
  buddy?.webContents.send('buddy', { ...buddyLook, open: buddyOpen, keys });
}

ipcMain.on('buddy', (_event, command) => {
  if (!buddy) return;
  switch (command) {
    case 'drag-start': {
      if (buddyOpen) setBuddyOpen(false);
      const cursor = screen.getCursorScreenPoint();
      const start = buddy.getBounds();
      const offset = { x: cursor.x - start.x, y: cursor.y - start.y };
      clearInterval(dragTimer);
      let last = null;
      dragTimer = setInterval(() => {
        if (!buddy) return;
        const point = screen.getCursorScreenPoint();
        const x = point.x - offset.x;
        const y = point.y - offset.y;
        if (last && last.x === x && last.y === y) return;
        last = { x, y };
        // Fixed size each time: setPosition alone can grow or drift the
        // window on scaled Windows displays.
        buddy.setBounds({ x, y, width: BUDDY.width, height: BUDDY.height });
      }, 12);
      break;
    }
    case 'drag-end': {
      clearInterval(dragTimer);
      dragTimer = null;
      keepBuddyOnScreen();
      settings.set({ buddyPosition: shibaPosition() });
      break;
    }
    case 'hit':
      buddy.setIgnoreMouseEvents(false);
      clearTimeout(buddyCloseTimer);
      break;
    case 'miss':
      buddy.setIgnoreMouseEvents(true, { forward: true });
      // The menu closes by itself once the mouse has left it for a moment.
      clearTimeout(buddyCloseTimer);
      if (buddyOpen) buddyCloseTimer = setTimeout(() => setBuddyOpen(false), 1800);
      break;
    case 'open':
      setBuddyOpen(true);
      break;
    case 'close':
      setBuddyOpen(false);
      break;
    case 'tldr':
    case 'read':
      setBuddyOpen(false);
      listenToSelection(command);
      break;
    case 'pick':
      setBuddyOpen(false);
      startPicker('tldr');
      break;
    case 'menu':
      if (tray && trayMenu) tray.popUpContextMenu(trayMenu());
      break;
    default:
      break;
  }
});

/**
 * TL;DR or Read from the Shiba: the text selected in the app you're using
 * (copied for you, no screenshot), or what you copied if nothing is selected.
 */
async function listenToSelection(action) {
  let selected = '';
  try {
    selected = await selection.selectedText(clipboard);
  } catch {
    selected = '';
  }
  if (selected) return run(action, selected, { source: 'Selected text' });
  return run(action);
}

// ---------------------------------------------------------------------------
// The paragraph picker

let pickerState = null;

function createPicker() {
  picker = new BrowserWindow({
    show: false, frame: false, transparent: false, resizable: false, movable: false, skipTaskbar: true,
    hasShadow: false, alwaysOnTop: true, fullscreenable: false, backgroundColor: '#000000',
    ...(isMac ? { type: 'panel' } : {}),
    webPreferences: { preload: path.join(__dirname, 'ui', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  picker.setAlwaysOnTop(true, 'screen-saver');
  picker.loadFile(path.join(__dirname, 'ui', 'select.html'));
  picker.on('closed', () => { picker = null; });
}

/** Screenshot of a display, at its full resolution. */
async function captureDisplay(display) {
  const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error('capture failed');
  return source.thumbnail;
}

async function startPicker(action) {
  if (!screenReader) {
    // Pro: finding the paragraphs on screen isn't part of the Community edition.
    showMessage(`Pick on screen comes with Notchman Pro. Here, select text and press ${pretty(settings.get('tldrShortcut'))}.`, 7000);
    return;
  }
  if (!picker || pickerState) return;
  const anchor = buddy ? shibaPosition() : screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(anchor);
  // Notchman's own windows stay out of the screenshot.
  const hadPill = pill?.isVisible();
  buddy?.hide();
  if (hadPill) pill.hide();
  await new Promise((resolve) => setTimeout(resolve, 140));

  let image;
  try {
    image = await captureDisplay(display);
  } catch {
    buddy?.showInactive();
    if (hadPill) pill.showInactive();
    showMessage(isMac
      ? 'Notchman needs Screen Recording permission: System Settings → Privacy & Security → Screen Recording.'
      : "Couldn't see the screen. Try again.", 8000);
    return;
  }
  const token = Symbol('pick');
  pickerState = { token, action, paragraphs: null, hadPill };
  picker.setBounds(display.bounds);
  picker.webContents.send('select', { image: image.toDataURL(), action, phase: 'reading', paragraphs: null });
  picker.show();
  picker.focus();

  try {
    const found = await screenReader.findParagraphs(image, display.scaleFactor, path.join(app.getPath('userData'), 'ocr'));
    if (pickerState?.token !== token) return;
    pickerState.paragraphs = found;
    picker.webContents.send('select', { phase: 'ready', paragraphs: found });
  } catch (error) {
    console.error('screen reading failed', error);
    if (pickerState?.token !== token) return;
    pickerState.paragraphs = [];
    picker.webContents.send('select', { phase: 'ready', paragraphs: [] });
  }
}

function closePicker() {
  const state = pickerState;
  pickerState = null;
  picker?.hide();
  buddy?.showInactive();
  if (state?.hadPill && session) pill?.showInactive();
}

ipcMain.on('select', (_event, command, ids) => {
  if (!pickerState) return;
  if (command === 'cancel') {
    closePicker();
    return;
  }
  if (command === 'pick' && Array.isArray(ids)) {
    const chosen = (pickerState.paragraphs || []).filter((p) => ids.includes(p.id));
    const { action } = pickerState;
    closePicker();
    if (chosen.length) run(action, proParagraphs.joinParagraphs(chosen), { source: 'On screen' });
  }
});

// ---------------------------------------------------------------------------
// Tray and settings

function createTray() {
  const image = nativeImage.createFromPath(asset(isMac ? 'tray.png' : 'tray@2x.png'));
  if (isMac) image.setTemplateImage(false);
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip('Notchman');
  const menu = () => Menu.buildFromTemplate([
    { label: screenReader ? 'TL;DR a paragraph on screen…' : 'TL;DR a paragraph on screen… (Pro)', click: () => startPicker('tldr') },
    { label: `TL;DR what I copied   ${pretty(settings.get('tldrShortcut'))}`, click: () => run('tldr') },
    { label: `Read what I copied   ${pretty(settings.get('readShortcut'))}`, click: () => run('read') },
    { type: 'separator' },
    {
      label: 'Show the Shiba', type: 'checkbox', checked: Boolean(buddy),
      click: (item) => {
        settings.set({ showBuddy: item.checked });
        if (item.checked && !buddy) createBuddy();
        if (!item.checked && buddy) buddy.close();
      },
    },
    ...(!updater ? [] : [updateAvailable
      ? (process.platform === 'win32'
        ? { label: `Restart to update to ${updateAvailable}`, click: () => updater.install() }
        : { label: `Update to ${updateAvailable}…`, click: () => openDashboard('about') })
      : { label: 'Check for updates…', click: () => openDashboard('about') }]),
    { label: 'Open Notchman…', click: () => openDashboard('home') },
    { label: 'History…', click: () => openDashboard('history') },
    edition.community
      ? { label: 'Get Notchman Pro…', click: () => shell.openExternal(PRO_URL) }
      : { label: 'Upgrade…', click: () => openDashboard('plan') },
    { label: 'Settings…', click: openSettings },
    { label: 'Website', click: () => shell.openExternal('https://notchman.app') },
    { type: 'separator' },
    { label: `Notchman ${edition.community ? 'Community ' : ''}${app.getVersion()}`, enabled: false },
    { label: 'Quit Notchman', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu());
  tray.on('click', () => tray.popUpContextMenu(menu()));
  trayMenu = menu;
}

// The Notchman window: Home (plan and usage), History, Plan (upgrade) and
// Settings. `openSettings()` opens it on the Settings tab.
function openDashboard(tab = 'home') {
  if (dashboard) {
    dashboard.webContents.send('dashboard:tab', tab);
    dashboard.show();
    dashboard.focus();
    return;
  }
  dashboard = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    title: 'Notchman',
    icon: asset('icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#c4e4fa',
    webPreferences: { preload: path.join(__dirname, 'ui', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  dashboard.loadFile(path.join(__dirname, 'ui', 'dashboard.html'), { query: { tab } });
  // Links (Terms, Privacy, checkout) open in the browser, never inside the app.
  dashboard.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  dashboard.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) {
      event.preventDefault();
      if (/^https:\/\//.test(url)) shell.openExternal(url);
    }
  });
  dashboard.on('closed', () => { dashboard = null; });
}

function openSettings() {
  openDashboard('settings');
}

let serverUpgradeLinks = {};
ipcMain.handle('dashboard:usage', async () => {
  try {
    const usage = await api.usage();
    if (usage.upgradeLinks) serverUpgradeLinks = usage.upgradeLinks;
    return { ok: true, ...usage };
  } catch (error) {
    return { ok: false, message: friendly(error) };
  }
});
ipcMain.handle('dashboard:history', () => history.list());
ipcMain.on('dashboard:action', (_event, action) => {
  if (action === 'tldr' || action === 'read') run(action);
  if (action === 'pick') startPicker('tldr');
  if (action === 'pro') shell.openExternal(PRO_URL);
});
ipcMain.handle('dashboard:check-update', () => (updater ? updater.check() : { ok: false, community: edition.community, store: storeApp }));
ipcMain.handle('dashboard:install-update', () => (updater ? updater.install() : { ok: false, message: 'Update with git pull.' }));
ipcMain.handle('dashboard:history-remove', (_event, id) => { history.remove(id); return history.list(); });
ipcMain.handle('dashboard:history-clear', () => { history.clear(); return []; });
ipcMain.on('dashboard:replay', (_event, id) => replay(id));
ipcMain.handle('dashboard:upgrade', async (_event, plan) => {
  if (edition.community) {
    shell.openExternal(PRO_URL);
    return { ok: true };
  }
  if (plan !== 'pro' && plan !== 'proplus') return { ok: false };
  // Dodo Payments checkout, made by our server for this install.
  try {
    const { url } = await api.checkout(plan);
    if (/^https:\/\//.test(url)) {
      shell.openExternal(url);
      return { ok: true };
    }
  } catch (error) {
    const link = serverUpgradeLinks[plan] || config.upgradeLinks[plan];
    if (link) {
      shell.openExternal(link.replace('{userId}', encodeURIComponent(settings.get('installId'))));
      return { ok: true };
    }
    return { ok: false, message: friendly(error) };
  }
  return { ok: false, message: "Checkout couldn't be opened. Please try again." };
});

ipcMain.handle('settings:get', () => ({
  edition: edition.community ? 'community' : 'pro',
  settings: { ...settings.all(), showBuddy: settings.get('showBuddy') !== false },
  canOpenAtLogin,
  upgradeConfigured: Boolean(config.upgradeLinks.pro || config.upgradeLinks.proplus),
  voices: config.voices,
  shortcutChoices: config.shortcutChoices,
  platform: process.platform,
  version: app.getVersion(),
}));

ipcMain.handle('settings:set', (_event, changes) => {
  const allowed = {};
  if (config.voices.some((v) => v.id === changes.voiceId)) allowed.voiceId = changes.voiceId;
  if ([0.75, 1, 1.25, 1.5, 1.75, 2].includes(changes.speed)) allowed.speed = changes.speed;
  if (config.shortcutChoices.tldr.includes(changes.tldrShortcut)) allowed.tldrShortcut = changes.tldrShortcut;
  if (config.shortcutChoices.read.includes(changes.readShortcut)) allowed.readShortcut = changes.readShortcut;
  if (typeof changes.openAtLogin === 'boolean') allowed.openAtLogin = changes.openAtLogin;
  if (typeof changes.showBuddy === 'boolean') allowed.showBuddy = changes.showBuddy;
  const updated = settings.set(allowed);
  if ('tldrShortcut' in allowed || 'readShortcut' in allowed) {
    registerShortcuts();
    buddyState({});
  }
  if ('openAtLogin' in allowed) setOpenAtLogin(allowed.openAtLogin);
  if ('showBuddy' in allowed) {
    if (allowed.showBuddy && !buddy) createBuddy();
    if (!allowed.showBuddy && buddy) buddy.close();
  }
  if ('speed' in allowed) sendState({ kind: 'speed', speed: allowed.speed });
  if (tray) createTrayMenuRefresh();
  return updated;
});

function createTrayMenuRefresh() {
  tray.destroy();
  createTray();
}

ipcMain.handle('voice:preview', async (_event, voiceId) => {
  if (!config.voices.some((v) => v.id === voiceId)) return null;
  try {
    return await api.speak({ text: "Hi, I'm your Notchman voice. Copy anything and I'll tell you what matters.", voiceId });
  } catch (error) {
    if (Notification.isSupported()) new Notification({ title: 'Notchman', body: friendly(error) }).show();
    return null;
  }
});

// ---------------------------------------------------------------------------
// Uninstall (About in the Notchman window)

ipcMain.handle('uninstall:info', () => ({
  // installed: Windows installer; store: Microsoft Store; mac-app: Notchman.app; source: a downloaded folder (npm start)
  kind: runFromSource ? 'source' : storeApp ? 'store' : isMac ? 'mac-app' : 'installed',
  folder: runFromSource ? app.getAppPath() : undefined,
}));

ipcMain.handle('uninstall:run', async () => {
  const data = app.getPath('userData');
  // How the app itself goes away, worked out before anything is removed.
  let removeApp = async () => {};
  if (runFromSource) {
    // Their downloaded folder: shown so they can delete it (it may hold their own changes).
    const folder = app.getAppPath();
    removeApp = () => shell.openPath(folder);
  } else if (storeApp) {
    // Windows removes Store apps itself: open its Installed apps page.
    removeApp = () => shell.openExternal('ms-settings:appsfeatures');
  } else if (process.platform === 'win32') {
    const uninstaller = path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`);
    if (!fs.existsSync(uninstaller)) {
      return { ok: false, message: 'Remove Notchman from Windows Settings → Apps → Installed apps.' };
    }
    // The installer's own uninstaller removes the app, its shortcuts and (with
    // this option) its data folder once Notchman has quit.
    removeApp = async () => spawn(uninstaller, ['/S', '--delete-app-data'], { detached: true, stdio: 'ignore' }).unref();
  } else if (isMac) {
    const bundle = path.resolve(process.execPath, '..', '..', '..');
    if (!bundle.endsWith('.app')) return { ok: false, message: 'Drag Notchman from Applications to the Trash.' };
    removeApp = () => shell.trashItem(bundle).catch(() => {});
  }

  setOpenAtLogin(false);
  globalShortcut.unregisterAll();
  history?.clear();
  // Notchman's data: history, keys, settings, the voice cache. Files Electron
  // still has open are skipped (on Windows the uninstaller removes them).
  // (Only ever Notchman's own folder, never a shared one.)
  if (/notchman/i.test(path.basename(data))) {
    for (const name of fs.readdirSync(data)) {
      try { fs.rmSync(path.join(data, name), { recursive: true, force: true }); } catch { /* in use */ }
    }
    try { fs.rmdirSync(data); } catch { /* not empty yet */ }
  }
  await removeApp();
  setTimeout(() => app.exit(0), 400);
  return { ok: true };
});

// For the end-to-end test harness (test/e2e).
module.exports = { run, openSettings, startPicker, showMessage, TERMS_VERSION };
