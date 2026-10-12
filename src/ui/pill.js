'use strict';

// The pill at the top of the screen: shows each step, then plays the voice
// piece by piece (the first piece is short, so speech starts almost at once,
// while later pieces are voiced ahead).

const $ = (id) => document.getElementById(id);
const pillEl = $('pill');

let player = null;
let hideTimer = null;
let hovering = false;

pillEl.addEventListener('mouseenter', () => { hovering = true; });
pillEl.addEventListener('mouseleave', () => {
  hovering = false;
  if (player?.done) scheduleHide(2500);
});

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
      setControls({ back: true, playPause: true, forward: true, speed: true, original: state.canReadOriginal, stop: true });
      $('speed').textContent = `${state.speed || 1}×`;
      startPlayer(state);
      break;
    case 'error':
      stopPlayer();
      show('error');
      $('title').textContent = 'Notchman';
      $('status').textContent = state.message;
      setControls({ stop: true });
      scheduleHide(6000);
      break;
    case 'message':
      stopPlayer();
      show('message');
      $('title').textContent = state.message;
      setControls({ stop: true });
      scheduleHide(state.hideAfter || 5000);
      break;
    case 'speed':
      if (player) player.setSpeed(state.speed);
      $('speed').textContent = `${state.speed}×`;
      break;
    default:
      break;
  }
});

/** "2:48 of 12 min · LinkedIn": the TL;DR's length against the original's. */
function statusLine({ source, action, spokenWords, originalWords, speed }) {
  const rate = 150 * (speed || 1);
  const spoken = duration((spokenWords || 0) / rate);
  if (action !== 'tldr') return `${spoken} · ${source}`;
  return `${spoken} of ${duration((originalWords || 0) / rate, true)} · ${source}`;
}

function duration(minutes, rough = false) {
  const seconds = Math.max(1, Math.round(minutes * 60));
  if (rough && seconds >= 90) return `${Math.round(seconds / 60)} min`;
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function show(mode) {
  clearTimeout(hideTimer);
  pillEl.className = `pill ${mode}`;
  $('bar').style.width = '0%';
}

function hide() {
  clearTimeout(hideTimer);
  pillEl.classList.add('hidden');
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
  for (const id of ['back', 'playPause', 'forward', 'speed', 'original', 'stop']) {
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
    speech.cancel();
    speech.speak(utterance);
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
      p.done = true;
      pillEl.classList.remove('speaking');
      $('bar').style.width = '100%';
      $('status').textContent = 'Done';
      setPaused(true);
      scheduleHide(4000);
    }
  }

  audio.addEventListener('ended', next);

  audio.addEventListener('timeupdate', () => {
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

// Buttons act on press (pointerdown): the pill never takes focus, and on
// Windows a full click on such a window could get lost.
const press = (id, fn) => $(id).addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  clearTimeout(hideTimer);
  fn();
});
const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];
press('playPause', () => player?.toggle());
press('back', () => player?.seek(-15));
press('forward', () => player?.seek(15));
press('speed', () => {
  const current = parseFloat($('speed').textContent) || 1;
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(current) + 1) % SPEEDS.length];
  $('speed').textContent = `${nextSpeed}×`;
  player?.setSpeed(nextSpeed);
  window.notchman.setSpeed(nextSpeed);
});
press('original', () => window.notchman.control('original'));
press('stop', () => {
  stopPlayer();
  pillEl.classList.add('hidden');
  window.notchman.control('stop');
});
