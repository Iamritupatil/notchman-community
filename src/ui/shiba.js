'use strict';

// The full-body Shiba (pixel art: scripts/shiba_sprites.py), alive but calm:
// now and then it blinks and wags its tail; it waves hello, talks while the
// voice plays and looks up while a TL;DR is being made. With "reduce motion"
// it sits still. Same timing as ShibaBuddy in the iPhone app.
//
//   const shiba = window.createShiba(element, { scale: 2 });
//   shiba.setMood('hello' | 'idle' | 'talking' | 'thinking');

(() => {
  // The order of the frames in assets/shiba-sprites.png.
  const FRAMES = ['idle', 'wag', 'blink', 'wave1', 'wave2', 'talk1', 'talk2', 'think'];
  const CELL = { width: 34, height: 30 };
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');

  const blinking = (t) => t % 4.2 > 4.0;

  /** The frame `t` seconds into a mood. A wave lasts 2.4 s, then it idles. */
  function frameFor(mood, t) {
    if (mood === 'hello' && t < 2.4) return Math.floor(t / 0.3) % 2 === 0 ? 'wave1' : 'wave2';
    if (mood === 'talking') return Math.floor(t / 0.2) % 2 === 0 ? 'talk1' : 'talk2';
    if (mood === 'thinking') return blinking(t) ? 'blink' : 'think';
    if (blinking(t)) return 'blink';
    const cycle = t % 7; // a short wag every 7 seconds
    if (cycle > 5.6) return Math.floor(cycle / 0.2) % 2 === 0 ? 'wag' : 'idle';
    return 'idle';
  }

  function createShiba(element, { scale = 2 } = {}) {
    element.classList.add('shiba-sprite');
    element.style.width = `${CELL.width * scale}px`;
    element.style.height = `${CELL.height * scale}px`;
    element.style.backgroundSize = `${CELL.width * scale * FRAMES.length}px ${CELL.height * scale}px`;
    let mood = 'idle';
    let started = performance.now();
    let shown = null;

    function draw() {
      const name = still.matches ? 'idle' : frameFor(mood, (performance.now() - started) / 1000);
      if (name === shown) return;
      shown = name;
      element.style.backgroundPosition = `${-FRAMES.indexOf(name) * CELL.width * scale}px 0`;
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
      stop: () => clearInterval(timer),
    };
  }

  window.createShiba = createShiba;
})();
