'use strict';

const $ = (id) => document.getElementById(id);
let state;

function pretty(key, platform) {
  const mac = platform === 'darwin';
  return key.replace('CommandOrControl', mac ? '⌘' : 'Ctrl').replace('Alt', mac ? '⌥' : 'Alt')
    .replace('Shift', mac ? '⇧' : 'Shift').replace(/\+/g, mac ? '' : '+');
}

async function save(changes) {
  state.settings = await window.notchman.setSettings(changes);
  render();
}

function render() {
  const { settings, voices, shortcutChoices, platform, version } = state;
  $('tldrKeyLabel').textContent = pretty(settings.tldrShortcut, platform);

  const list = $('voices');
  list.replaceChildren(...voices.map((voice) => {
    const row = document.createElement('div');
    row.className = `voice${voice.id === settings.voiceId ? ' selected' : ''}`;
    const name = Object.assign(document.createElement('span'), { className: 'name', textContent: voice.name });
    const detail = Object.assign(document.createElement('span'), { className: 'detail', textContent: voice.detail });
    const preview = Object.assign(document.createElement('button'), { textContent: 'Play' });
    preview.addEventListener('click', async (event) => {
      event.stopPropagation();
      preview.textContent = '…';
      const bytes = await window.notchman.previewVoice(voice.id);
      preview.textContent = 'Play';
      if (bytes) new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))).play();
    });
    row.append(name, detail, preview);
    row.addEventListener('click', () => save({ voiceId: voice.id }));
    return row;
  }));

  $('speeds').replaceChildren(...[0.75, 1, 1.25, 1.5, 1.75, 2].map((speed) => {
    const button = Object.assign(document.createElement('button'), { textContent: `${speed}×` });
    if (speed === settings.speed) button.className = 'selected';
    button.addEventListener('click', () => save({ speed }));
    return button;
  }));

  for (const [id, choices] of [['tldrShortcut', shortcutChoices.tldr], ['readShortcut', shortcutChoices.read]]) {
    const select = $(id);
    select.replaceChildren(...choices.map((key) => {
      const option = Object.assign(document.createElement('option'), { value: key, textContent: pretty(key, platform) });
      option.selected = key === settings[id];
      return option;
    }));
    select.onchange = () => save({ [id]: select.value });
  }

  $('openAtLogin').checked = Boolean(settings.openAtLogin);
  $('openAtLogin').onchange = () => save({ openAtLogin: $('openAtLogin').checked });
  $('version').textContent = `Version ${version}`;
}

window.notchman.getSettings().then((initial) => {
  state = initial;
  render();
});
