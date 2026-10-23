'use strict';

// The floating Shiba. Press and move to drag it anywhere (the position is
// remembered); a click without moving opens TL;DR / Read.

const buddy = document.getElementById('buddy');
const shiba = document.getElementById('shiba');
// The Shiba itself, just its head: happy hello when Notchman starts, one ear up
// while it listens (you hover it or open its menu), thinking while a TL;DR is
// being made, talking while the voice plays.
const art = window.createShiba(document.getElementById('shibaArt'), { scale: 2, variant: 'head' });
art.setMood('hello');
let last = {};
let hovering = false;
function updateMood() {
  art.setMood(last.busy ? 'thinking' : last.speaking ? 'talking' : last.open || hovering ? 'listening'
    : art.mood === 'hello' ? 'hello' : 'idle');
}
let press = null;

// A press only becomes a drag once the mouse really moves; otherwise it's a
// click, which opens the menu. (Starting the drag on press made clicks get
// lost on Windows.)
shiba.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  press = { x: event.screenX, y: event.screenY, dragging: false };
});

window.addEventListener('mousemove', (event) => {
  if (!press || press.dragging) return;
  if (Math.abs(event.screenX - press.x) + Math.abs(event.screenY - press.y) > 5) {
    press.dragging = true;
    window.notchman.buddy('drag-start');
  }
});

window.addEventListener('mouseup', () => {
  if (!press) return;
  const { dragging } = press;
  press = null;
  if (dragging) window.notchman.buddy('drag-end');
  else window.notchman.buddy(buddy.classList.contains('open') ? 'close' : 'open');
});

window.addEventListener('blur', () => {
  if (press?.dragging) window.notchman.buddy('drag-end');
  press = null;
});

// Only the Shiba and (when open) the menu take clicks; elsewhere the window
// lets them through to the app below. Main is told when that changes.
let overSomething = false;
function track(event) {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const over = Boolean(press) || Boolean(target && (target.closest('.shiba') || (buddy.classList.contains('open') && target.closest('.menu'))));
  if (over !== overSomething) {
    overSomething = over;
    window.notchman.buddy(over ? 'hit' : 'miss');
  }
  if (hovering !== over) {
    hovering = over;
    updateMood();
  }
}
window.addEventListener('mousemove', track);
document.addEventListener('mouseleave', () => {
  if (press) return;
  overSomething = false;
  window.notchman.buddy('miss');
  hovering = false;
  updateMood();
});

shiba.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.notchman.buddy('menu');
});

document.getElementById('tldr').addEventListener('click', () => window.notchman.buddy('tldr'));
document.getElementById('read').addEventListener('click', () => window.notchman.buddy('read'));
document.getElementById('pick').addEventListener('click', () => window.notchman.buddy('pick'));
document.getElementById('stopItem').addEventListener('click', () => window.notchman.buddy('stop'));

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.notchman.buddy('close');
});

window.notchman.onBuddy((state) => {
  buddy.classList.toggle('open', Boolean(state.open));
  buddy.classList.toggle('left', state.side === 'left');
  for (const v of ['top', 'center', 'bottom']) buddy.classList.toggle(`v-${v}`, state.valign === v);
  buddy.classList.toggle('busy', Boolean(state.busy));
  buddy.classList.toggle('speaking', Boolean(state.speaking));
  last = state;
  updateMood();
  buddy.classList.toggle('community', Boolean(state.community));
  if (state.keys) {
    document.getElementById('tldrKey').textContent = state.keys.tldr || '';
    document.getElementById('readKey').textContent = state.keys.read || '';
  }
});
