'use strict';

// Makes text speakable and splits it into pieces for the voice.

/** Markdown and symbols out, words in: what the voice should actually say. */
function clean(text) {
  let t = text.replace(/\r\n?/g, '\n');
  // Code blocks: a short notice instead of reading code aloud.
  t = t.replace(/```[\s\S]*?```/g, '\n(There\'s a code block here.)\n');
  t = t.replace(/`([^`\n]+)`/g, '$1');
  // Links read as their text; bare URLs are not pronounced.
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  t = t.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1');
  t = t.replace(/https?:\/\/\S+/g, 'link');
  // Headings, quotes, bullets and numbered lists become plain sentences.
  t = t.replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, (_, h) => endSentence(h));
  t = t.replace(/^\s*>\s?/gm, '');
  t = t.replace(/^\s*(?:[-*+•]|\d+[.)])\s+(.+)$/gm, (_, item) => endSentence(item));
  t = t.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '');
  // Emphasis markers.
  t = t.replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2');
  // Tables: cells joined into sentences.
  t = t.replace(/^\s*\|?\s*:?-{2,}.*$/gm, '');
  t = t.replace(/^\s*\|(.+)\|\s*$/gm, (_, row) => endSentence(row.split('|').map((c) => c.trim()).filter(Boolean).join(', ')));
  // Citation marks like [1] and most emoji.
  t = t.replace(/\[\d+\]/g, '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
  return t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function endSentence(s) {
  const trimmed = s.trim();
  return /[.!?:;]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Sentence-aligned pieces: ~160 characters first (so the voice starts almost
 * at once), then ~600, then ~1,400. Each stays under the server's limit.
 * @returns {string[]}
 */
function split(text) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
  const sentences = [];
  for (const { segment } of segmenter.segment(text)) {
    let s = segment;
    while (s.length > 2000) {
      const cut = s.lastIndexOf(' ', 2000);
      const at = cut > 0 ? cut : 2000;
      sentences.push(s.slice(0, at));
      s = s.slice(at);
    }
    sentences.push(s);
  }
  const pieces = [];
  let current = '';
  const target = () => (pieces.length === 0 ? 160 : pieces.length === 1 ? 600 : 1400);
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > Math.max(target(), 2000)) {
      flush();
    }
    current += sentence;
    if (current.length >= target()) flush();
  }
  flush();
  return pieces;

  function flush() {
    const piece = current.trim();
    if (piece) pieces.push(piece);
    current = '';
  }
}

module.exports = { clean, split };
