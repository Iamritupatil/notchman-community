'use strict';

// The pill at the top of the screen: shows each step, then plays the voice
// piece by piece (the first piece is short, so speech starts almost at once,
// while later pieces are voiced ahead).

const $ = (id) => document.getElementById(id);
const pillEl = $('pill');
// Windows 11 frosts what's behind the pill itself (see main.js).
if (new URLSearchParams(location.search).get('glass') === 'system') document.documentElement.classList.add('system-glass');

let player = null;
let hideTimer = null;
let hovering = false;

// Clicks reach the pill only while the mouse is over it: everywhere else the
// window lets them through to the app below. This is the same way the
// floating Shiba takes clicks, which works on every Windows setup.
function setHovering(over) {
  if (over === hovering) return;
  hovering = over;
  window.notchman.control(over ? 'hit' : 'miss');
  if (!over && player?.done) scheduleHide(2500);
}
window.addEventListener('mousemove', (event) => {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  setHovering(Boolean(target && target.closest('.pill:not(.hidden)')));
});
document.addEventListener('mouseleave', () => setHovering(false));
// Some Windows setups don't forward mouse moves: entering the pill counts too.
pillEl.addEventListener('pointerenter', () => setHovering(!pillEl.classList.contains('hidden')));

window.notchman.onState((state) => {
  switch (state.kind) {
    case 'working':
      stopPlayer();
      show('working');
      $('title').textContent = state.title || (state.action === 'tldr' ? 'TL;DR' : 'Read');
      $('status').textContent = state.status;
      setControls({ stop: true });
      break;
    case 'play':
      show('speaking');
      $('title').textContent = state.title || 'Notchman';
      $('status').textContent = statusLine(state);
      setControls({ back: true, playPause: true, original: state.canReadOriginal, stop: true });
      showApp(state.app, state.appIcon);
      startPlayer(state);
      break;
    case 'error':
      stopPlayer();
      show('error');
      $('title').textContent = state.title || 'Notchman';
      $('status').textContent = state.message;
      setControls({ stop: true });
      scheduleHide(state.upgrade ? 10000 : 6000);
      break;
    case 'message':
      stopPlayer();
      show('message');
      $('title').textContent = state.message;
      setControls({ stop: true });
      scheduleHide(state.hideAfter || 5000);
      break;
    case 'app':
      // The app they're in, known a moment after the press.
      if (['working', 'message', 'error'].some((mode) => pillEl.classList.contains(mode))) showApp(state.app, state.appIcon);
      break;
    case 'stop':
      // Stopped from the Shiba or the tray.
      stopPlayer();
      pillEl.classList.add('hidden');
      setHovering(false);
      break;
    case 'speed':
      if (player) player.setSpeed(state.speed);
      break;
    default:
      break;
  }
});

/** "2:48 of 12 min · LinkedIn": the TL;DR's length against the original's. */
function statusLine({ source, action, spokenWords, originalWords, speed }) {
  const rate = 150 * (speed || 1);
  const spoken = duration((spokenWords || 0) / rate);
  if (action !== 'tldr') return `${spoken} • ${source}`;
  return `${spoken} of ${duration((originalWords || 0) / rate, true)} • ${source}`;
}

function duration(minutes, rough = false) {
  const seconds = Math.max(1, Math.round(minutes * 60));
  if (rough && seconds >= 90) return `${Math.round(seconds / 60)} min`;
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// The logo of the app the text came from (ChatGPT, Claude, X, LinkedIn, Grok);
// otherwise the icon of the app they're using (Chrome, WhatsApp, Word…).
const APP_LOGOS = new Set(['chatgpt', 'claude', 'x', 'linkedin', 'grok']);
function showApp(app, icon) {
  const logo = $('appLogo');
  if (APP_LOGOS.has(app)) {
    logo.src = `../../assets/sources/${app}.png`;
    logo.dataset.app = app;
  } else if (typeof icon === 'string' && icon.startsWith('data:image/')) {
    logo.src = icon;
    logo.dataset.app = 'native';
  } else {
    logo.removeAttribute('src');
    logo.hidden = true;
    return;
  }
  logo.hidden = false;
}

function show(mode) {
  // A new press or a plain message starts without a logo; an error keeps the app's.
  if (mode === 'working' || mode === 'message') showApp(null);
  clearTimeout(hideTimer);
  pillEl.className = `pill ${mode}`;
  $('bar').style.width = '0%';
}

function hide() {
  clearTimeout(hideTimer);
  pillEl.classList.add('hidden');
  setHovering(false);
  setTimeout(() => window.notchman.control('hide'), 220);
}

function scheduleHide(ms) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (hovering) return scheduleHide(1500);
    hide();
  }, ms);
}

function setControls(visible) {
  for (const id of ['back', 'playPause', 'original', 'stop']) {
    $(id).classList.toggle('gone', !visible[id]);
  }
}

// --- Player ------------------------------------------------------------------

function startPlayer(state) {
  stopPlayer();
  player = createPlayer(state);
  player.play(0);
}

function stopPlayer() {
  if (player) player.destroy();
  player = null;
}

function createPlayer({ id, pieceCount, speed }) {
  const audio = new Audio();
  const speech = window.speechSynthesis;
  const loaded = new Map(); // index → promise of { url } or { speak: text } (computer voice) or null
  let index = 0;
  let destroyed = false;
  let rate = speed || 1;
  let speaking = null; // the computer voice's current piece: { text, utterance, paused }
  const p = { done: false };

  function load(i) {
    if (i >= pieceCount) return Promise.resolve(null);
    if (!loaded.has(i)) {
      loaded.set(i, window.notchman.piece(id, i).then((result) => {
        if (!result) return null;
        if (typeof result.speak === 'string') return { speak: result.speak };
        return { url: URL.createObjectURL(new Blob([result.audio], { type: result.type || 'audio/mpeg' })) };
      }));
    }
    return loaded.get(i);
  }

  function stopSpeech() {
    speaking = null;
    speech.cancel();
  }

  /** The computer's own voice (Windows / macOS voices), used when the cloud voice isn't available. */
  function speakPiece(i, text) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.lang = 'en-US';
    speaking = { text, utterance, paused: false };
    utterance.onboundary = (event) => {
      if (index !== i) return;
      const part = text.length ? event.charIndex / text.length : 0;
      $('bar').style.width = `${Math.min(100, ((i + part) / pieceCount) * 100)}%`;
    };
    utterance.onend = () => {
      if (destroyed || index !== i || speaking?.utterance !== utterance) return;
      speaking = null;
      next();
    };
    utterance.onstart = started;
    speech.cancel();
    speech.speak(utterance);
  }

  let startedSent = false;
  function started() {
    if (startedSent) return;
    startedSent = true;
    window.notchman.control('audio-started');
  }

  async function play(i) {
    index = i;
    p.done = false;
    setPaused(false);
    audio.pause();
    stopSpeech();
    const piece = await load(i);
    // Voice the next two pieces while this one plays.
    load(i + 1);
    load(i + 2);
    if (destroyed || index !== i) return;
    if (!piece) return; // the error is shown by the main process
    if (piece.speak) return speakPiece(i, piece.speak);
    audio.src = piece.url;
    audio.playbackRate = rate;
    audio.preservesPitch = true;
    try {
      await audio.play();
    } catch { /* interrupted by a newer action */ }
  }

  function next() {
    if (index + 1 < pieceCount) {
      play(index + 1);
    } else {
      if (!p.done) window.notchman.control('audio-done');
      p.done = true;
      pillEl.classList.remove('speaking');
      $('bar').style.width = '100%';
      $('status').textContent = 'Done';
      setPaused(true);
      scheduleHide(4000);
    }
  }

  audio.addEventListener('ended', next);
  audio.addEventListener('playing', started);

  audio.addEventListener('timeupdate', () => {
    if (dragging) return;
    const part = audio.duration ? audio.currentTime / audio.duration : 0;
    $('bar').style.width = `${Math.min(100, ((index + part) / pieceCount) * 100)}%`;
  });

  function setPaused(paused) {
    $('iconPause').classList.toggle('gone', paused);
    $('iconPlay').classList.toggle('gone', !paused);
    pillEl.classList.toggle('speaking', !paused);
  }

  p.play = play;
  p.toggle = () => {
    if (p.done) return play(0);
    if (speaking) {
      if (speaking.paused) {
        speech.resume();
        speaking.paused = false;
        setPaused(false);
        clearTimeout(hideTimer);
      } else {
        speech.pause();
        speaking.paused = true;
        setPaused(true);
      }
      return;
    }
    if (audio.paused) {
      audio.play().catch(() => {});
      setPaused(false);
      clearTimeout(hideTimer);
    } else {
      audio.pause();
      setPaused(true);
    }
  };
  p.replay = () => play(0);
  /** Jumps by `seconds` (±15), across pieces when needed. */
  p.seek = async (seconds) => {
    if (speaking) {
      // The computer voice can't seek inside a piece: previous / next piece.
      const target = seconds < 0 ? Math.max(0, index - 1) : index + 1;
      if (target < pieceCount) play(target); else next();
      return;
    }
    let target = (audio.currentTime || 0) + seconds;
    if (target < 0 && index > 0) {
      const previous = await load(index - 1);
      if (previous?.url) {
        await play(index - 1);
        const length = audio.duration || 0;
        audio.currentTime = Math.max(0, length + target);
        return;
      }
    }
    if (audio.duration && target >= audio.duration) {
      if (index + 1 < pieceCount) {
        const carry = target - audio.duration;
        await play(index + 1);
        if (carry > 0 && audio.duration) audio.currentTime = Math.min(carry, audio.duration - 0.1);
      } else {
        audio.currentTime = Math.max(0, audio.duration - 0.05);
      }
      return;
    }
    audio.currentTime = Math.max(0, target);
    if (p.done) { p.done = false; audio.play().catch(() => {}); setPaused(false); }
  };
  /** Jumps to `fraction` (0–1) of the whole thing: the progress bar, clicked or dragged. */
  p.seekTo = async (fraction) => {
    const position = Math.max(0, Math.min(0.999, fraction)) * pieceCount;
    const target = Math.floor(position);
    if (target !== index || p.done || speaking) await play(target);
    // The computer voice starts each piece from its beginning; recorded audio jumps inside it.
    if (!speaking && audio.duration) audio.currentTime = (position - target) * audio.duration;
    $('bar').style.width = `${(position / pieceCount) * 100}%`;
  };
  p.setSpeed = (s) => {
    rate = s;
    audio.playbackRate = s;
    // The computer voice takes its speed per piece: restart this piece at the new speed.
    if (speaking && !speaking.paused) speakPiece(index, speaking.text);
  };
  p.destroy = () => {
    destroyed = true;
    audio.pause();
    audio.removeAttribute('src');
    stopSpeech();
    for (const pending of loaded.values()) pending.then((piece) => piece?.url && URL.revokeObjectURL(piece.url));
  };
  return p;
}

// --- Buttons -------------------------------------------------------------------

// Buttons act on press (pointerdown), with click as a fallback: the pill never
// takes focus, and either event alone has been lost on some Windows setups.
let pressedAt = 0;
function press(id, fn) {
  const act = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'click' && Date.now() - pressedAt < 600) return; // already handled on press
    if (event.type === 'pointerdown') pressedAt = Date.now();
    clearTimeout(hideTimer);
    fn();
  };
  $(id).addEventListener('pointerdown', act);
  $(id).addEventListener('click', act);
}
const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];
press('playPause', () => player?.toggle());
press('back', () => player?.seek(-15));
// The progress bar moves through what's playing: click it, or drag along it.
const seekEl = $('seek');
let dragging = false;
const fractionAt = (event) => {
  const rect = seekEl.querySelector('.progress').getBoundingClientRect();
  return (event.clientX - rect.left) / rect.width;
};
seekEl.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !player) return;
  event.preventDefault();
  event.stopPropagation();
  clearTimeout(hideTimer);
  dragging = true;
  seekEl.setPointerCapture(event.pointerId);
  pillEl.classList.add('seeking');
  $('bar').style.width = `${Math.max(0, Math.min(1, fractionAt(event))) * 100}%`;
});
seekEl.addEventListener('pointermove', (event) => {
  if (dragging) $('bar').style.width = `${Math.max(0, Math.min(1, fractionAt(event))) * 100}%`;
});
seekEl.addEventListener('pointerup', (event) => {
  if (!dragging) return;
  dragging = false;
  pillEl.classList.remove('seeking');
  player?.seekTo(fractionAt(event));
});
press('original', () => window.notchman.control('original'));
function close(command = 'stop') {
  stopPlayer();
  pillEl.classList.add('hidden');
  setHovering(false);
  window.notchman.control(command);
}
press('stop', close);
// A message or an error closes with a click anywhere on it (the buttons
// handle their own clicks first).
pillEl.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('button')) return;
  if (pillEl.classList.contains('message') || pillEl.classList.contains('error')) close();
});
