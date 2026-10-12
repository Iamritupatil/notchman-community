// The free, on-computer voice: Kokoro-82M (open source) running in this hidden
// window. The model downloads once (~90 MB) and is cached; after that it works
// offline. The main process sends text, this answers with WAV audio.

import { KokoroTTS } from '../vendor/kokoro.web.js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let ttsPromise = null;

function load() {
  ttsPromise ??= KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'wasm' }).catch((error) => {
    ttsPromise = null;
    throw error;
  });
  return ttsPromise;
}

/** Kokoro reads up to ~500 tokens at a time: sentences, grouped up to ~300 characters. */
function chunks(text) {
  const sentences = text.match(/[^.!?…\n]+[.!?…]*\s*/g) || [text];
  const result = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > 300) {
      result.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function wav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset, s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

async function speak(text, voice) {
  const tts = await load();
  const parts = [];
  let rate = 24000;
  for (const chunk of chunks(text)) {
    const audio = await tts.generate(chunk, { voice });
    rate = audio.sampling_rate;
    parts.push(audio.audio);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const samples = new Float32Array(total);
  let at = 0;
  for (const p of parts) { samples.set(p, at); at += p.length; }
  return wav(samples, rate);
}

window.kokoro.onWarmUp(() => { load().catch(() => {}); });
// One at a time: the model can't run two pieces at once.
let queue = Promise.resolve();
window.kokoro.onSpeak(({ id, text, voice }) => {
  queue = queue.then(async () => {
    try {
      window.kokoro.answer({ id, wav: await speak(text, voice) });
    } catch (error) {
      window.kokoro.answer({ id, error: String(error?.message || error) });
    }
  });
});
console.log(`voice engine: crossOriginIsolated=${self.crossOriginIsolated} cores=${navigator.hardwareConcurrency}`);
window.kokoro.ready();
