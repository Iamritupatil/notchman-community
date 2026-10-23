'use strict';

// The Settings page: voice, speed, shortcuts and general switches.

(() => {
  const $ = (id) => document.getElementById(id);
  let state;
  let previewAudio = null;

  function pretty(key, platform) {
    const mac = platform === 'darwin';
    return key.replace('CommandOrControl', mac ? '⌘' : 'Ctrl').replace('Alt', mac ? '⌥' : 'Alt')
      .replace('Shift', mac ? '⇧' : 'Shift').replace(/\+/g, mac ? '' : '+');
  }

  async function save(changes) {
    state.settings = await window.notchman.setSettings(changes);
    render();
  }

  function voiceRow(voice, selected) {
    const row = Object.assign(document.createElement('div'), { className: `voice${selected ? ' selected' : ''}` });
    row.setAttribute('role', 'radio');
    row.setAttribute('aria-checked', String(selected));
    row.tabIndex = 0;
    const preview = Object.assign(document.createElement('button'), { className: 'icon-btn accent', title: `Hear ${voice.name}` });
    preview.setAttribute('aria-label', `Hear ${voice.name}`);
    preview.append(window.icon('play'));
    preview.addEventListener('click', async (event) => {
      event.stopPropagation();
      preview.disabled = true;
      const bytes = await window.notchman.previewVoice(voice.id);
      preview.disabled = false;
      if (!bytes) return;
      previewAudio?.pause();
      previewAudio = new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })));
      previewAudio.play();
    });
    row.append(
      Object.assign(document.createElement('span'), { className: 'radio' }),
      Object.assign(document.createElement('span'), { className: 'name', textContent: voice.name }),
      Object.assign(document.createElement('span'), { className: 'voice-detail', textContent: voice.detail }),
      preview,
    );
    const choose = () => { if (!selected) save({ voiceId: voice.id }); };
    row.addEventListener('click', choose);
    row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } });
    return row;
  }

  function render() {
    const { settings, voices, shortcutChoices, platform } = state;

    $('voices').replaceChildren(...voices.map((voice) => voiceRow(voice, voice.id === settings.voiceId)));

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

    $('openAtLoginRow').classList.toggle('gone', state.canOpenAtLogin === false);
    $('openAtLogin').checked = Boolean(settings.openAtLogin);
    $('openAtLogin').onchange = () => save({ openAtLogin: $('openAtLogin').checked });
    $('showBuddy').checked = settings.showBuddy !== false;
    $('showBuddy').onchange = () => save({ showBuddy: $('showBuddy').checked });
    $('shareStats').checked = settings.shareStats !== false;
    $('shareStats').onchange = () => save({ shareStats: $('shareStats').checked });
  }

  window.notchman.getSettings().then((initial) => {
    state = initial;
    render();
  });
})();
