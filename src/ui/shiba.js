'use strict';

// The Shiba (pixel art: scripts/shiba_sprites.py), alive but calm. With
// "reduce motion" it sits still.
//
//   const head = window.createShiba(element, { scale: 2, variant: 'head' }); // just the head (used everywhere)
//   const shiba = window.createShiba(element, { scale: 2 });                 // full body (artwork)
//   shiba.setMood('hello' | 'idle' | 'listening' | 'talking' | 'thinking');
//
// Head (the floating Shiba, the Notchman window, the agreement): blinks and
// now and then twitches an ear; perks one ear up while it listens (you hover
// it or open its menu), looks up and sways while it thinks, talks while the
// voice plays, and is happy (eyes closed, both ears up) when it says hello.
// Same timing as ShibaBuddy in the iPhone app. The full body blinks, wags and
// waves.

(() => {
  const VARIANTS = {
    body: {
      // The order of the frames in assets/shiba-sprites.png.
      frames: ['idle', 'wag', 'blink', 'wave1', 'wave2', 'talk1', 'talk2', 'think'],
      cell: { width: 34, height: 30 },
      className: '',
    },
    head: {
      // The order of the frames in assets/shiba-head-sprites.png.
      frames: ['idle', 'blink', 'listen1', 'listen2', 'think1', 'think2', 'talk1', 'talk2', 'happy'],
      cell: { width: 20, height: 17 },
      className: 'head',
    },
  };
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const blinking = (t) => t % 4.2 > 4.0;
  const alternate = (t, every, a, b) => (Math.floor(t / every) % 2 === 0 ? a : b);

  /** The full-body frame `t` seconds into a mood. A wave lasts 2.4 s, then it idles. */
  function bodyFrame(mood, t) {
    if (mood === 'hello' && t < 2.4) return alternate(t, 0.3, 'wave1', 'wave2');
    if (mood === 'talking') return alternate(t, 0.2, 'talk1', 'talk2');
    if (mood === 'thinking') return blinking(t) ? 'blink' : 'think';
    if (blinking(t)) return 'blink';
    const cycle = t % 7; // a short wag every 7 seconds
    if (cycle > 5.6) return alternate(cycle, 0.2, 'wag', 'idle');
    return 'idle';
  }

  /** The head's frame `t` seconds into a mood. Hello lasts 1.6 s, then it idles. */
  function headFrame(mood, t) {
    if (mood === 'hello' && t < 1.6) return alternate(t, 0.4, 'happy', 'idle');
    if (mood === 'talking') return alternate(t, 0.2, 'talk1', 'talk2');
    if (mood === 'thinking') return blinking(t) ? 'blink' : alternate(t, 0.6, 'think1', 'think2');
    if (mood === 'listening') {
      // The ear goes up at once, then twitches every couple of seconds.
      const twitch = t > 0.3 && t % 2.6 < 0.24;
      return twitch ? 'listen2' : blinking(t) ? 'blink' : 'listen1';
    }
    if (blinking(t)) return 'blink';
    const cycle = t % 9; // an ear twitch every 9 seconds
    if (cycle > 7.8 && cycle < 8.4) return alternate(cycle, 0.15, 'listen2', 'listen1');
    return 'idle';
  }

  function createShiba(element, { scale = 2, variant = 'body' } = {}) {
    const { frames, cell, className } = VARIANTS[variant] || VARIANTS.body;
    const frameFor = variant === 'head' ? headFrame : bodyFrame;
    element.classList.add('shiba-sprite');
    if (className) element.classList.add(className);
    element.style.width = `${cell.width * scale}px`;
    element.style.height = `${cell.height * scale}px`;
    element.style.backgroundSize = `${cell.width * scale * frames.length}px ${cell.height * scale}px`;
    let mood = 'idle';
    let started = performance.now();
    let shown = null;

    function draw() {
      const name = still.matches ? 'idle' : frameFor(mood, (performance.now() - started) / 1000);
      if (name === shown) return;
      shown = name;
      element.style.backgroundPosition = `${-frames.indexOf(name) * cell.width * scale}px 0`;
    }
    const timer = setInterval(draw, 100);
    draw();

    return {
      setMood(next) {
        if (next === mood) return;
        mood = next;
        started = performance.now();
        draw();
      },
      get mood() { return mood; },
      stop: () => clearInterval(timer),
    };
  }

  window.createShiba = createShiba;
})();
