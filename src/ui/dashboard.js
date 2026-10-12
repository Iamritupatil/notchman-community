'use strict';

// The Notchman window: Home (quick actions, stats, plan), History (search,
// full text, replay), Plan (upgrade), About & updates. The Settings tab's
// controls are drawn by settings.js.

(() => {
  const $ = (id) => document.getElementById(id);
  const PLAN_NAMES = { free: 'Free', pro: 'Pro', proplus: 'Pro+' };
  let historyItems = [];
  let selectedId = null;

  function show(tab) {
    for (const button of document.querySelectorAll('.tab')) button.classList.toggle('active', button.dataset.tab === tab);
    for (const panel of document.querySelectorAll('.panel')) panel.classList.toggle('active', panel.dataset.panel === tab);
    if (tab === 'home' || tab === 'plan') loadUsage();
    if (tab === 'home' || tab === 'history') loadHistory();
    if (tab === 'about') checkUpdates();
  }

  for (const button of document.querySelectorAll('.tab')) button.addEventListener('click', () => show(button.dataset.tab));
  for (const link of document.querySelectorAll('[data-goto]')) link.addEventListener('click', () => show(link.dataset.goto));
  for (const action of document.querySelectorAll('[data-action]')) {
    action.addEventListener('click', () => window.notchman.dashboardAction(action.dataset.action));
  }

  const hour = new Date().getHours();
  $('greeting').textContent = hour < 12 ? 'Good morning!' : hour < 18 ? 'Good afternoon!' : 'Good evening!';

  // --- Plan and usage ---------------------------------------------------------

  const percent = (used, limit) => (limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0);
  const chars = (n) => Number(n || 0).toLocaleString();
  const minutes = (c) => Math.max(0, Math.round(c / 900));

  async function loadUsage() {
    const usage = await window.notchman.usage();
    if (usage.ok && usage.plan === 'community') {
      $('planLead').textContent = 'Notchman Community: free for personal, non-commercial use, with your own API keys.';
      return usage;
    }
    if (!usage.ok) {
      $('voiceNote').textContent = usage.message || "Couldn't load your plan. Check your connection.";
      $('planLead').textContent = "Couldn't load your plan right now.";
      $('sideVoice').textContent = "Couldn't load your plan";
      // Usually a moment without internet: try again shortly.
      clearTimeout(loadUsage.retry);
      loadUsage.retry = setTimeout(loadUsage, 15000);
      return usage;
    }
    const plan = PLAN_NAMES[usage.plan] || 'Free';
    const left = Math.max(0, (usage.voiceLimit || 0) - (usage.voiceUsed || 0));
    const period = usage.voicePeriod === 'day' ? 'today' : usage.voicePeriod === 'trial' ? 'in your free preview' : 'this month';
    $('planChip').textContent = `${plan} plan`;
    $('sideUpgrade').classList.toggle('gone', usage.plan === 'proplus');
    $('sideMeter').style.width = `${100 - percent(usage.voiceUsed, usage.voiceLimit)}%`;
    $('sideVoice').textContent = usage.voiceLimit ? `${chars(left)} voice characters left` : 'Free voice';
    $('voiceCount').textContent = usage.voiceLimit ? chars(left) : '–';
    $('voiceMeter').style.width = `${100 - percent(usage.voiceUsed, usage.voiceLimit)}%`;
    $('voiceNote').textContent = usage.voiceLimit
      ? `characters left ${period} (about ${minutes(left)} min). Then the free voice.`
      : 'You hear the free voice on your computer. Pro adds the Notchman voice.';
    $('planLead').textContent = usage.plan === 'free'
      ? "You're on Free. TL;DRs and reading always work with the free voice on your computer; upgrade for the natural Notchman voice."
      : `You're on ${plan}: ${chars(left)} Notchman-voice characters left ${period}. Thanks for supporting Notchman!`;
    for (const card of document.querySelectorAll('.plan')) {
      const current = card.dataset.plan === usage.plan;
      card.classList.toggle('current', current);
      const button = card.querySelector('button');
      if (card.dataset.plan !== 'free') button.textContent = current ? 'Your plan' : `Upgrade to ${PLAN_NAMES[card.dataset.plan]}`;
      else button.textContent = current ? 'Your plan' : 'Included';
    }
    return usage;
  }

  // After checkout opens: look every few seconds until the payment shows up
  // (Dodo tells our server within seconds), then celebrate. Up to 30 minutes.
  let waiting = null;
  function waitForPayment(plan) {
    clearInterval(waiting);
    const started = Date.now();
    waiting = setInterval(async () => {
      if (Date.now() - started > 30 * 60_000) { clearInterval(waiting); return; }
      const usage = await loadUsage();
      if (usage && usage.ok && (usage.plan === plan || usage.plan === 'proplus')) {
        clearInterval(waiting);
        for (const b of document.querySelectorAll('[data-upgrade]')) b.disabled = false;
        $('planLead').textContent = `Welcome to Notchman ${PLAN_NAMES[usage.plan]}! The natural Notchman voice is on. Thank you for supporting Notchman.`;
        new Notification('Welcome to Notchman ' + PLAN_NAMES[usage.plan], { body: 'Your plan is active. Enjoy the natural Notchman voice!' });
      }
    }, 6000);
  }

  for (const button of document.querySelectorAll('[data-upgrade]')) {
    button.addEventListener('click', async () => {
      const label = button.textContent;
      button.textContent = 'Opening checkout…';
      button.disabled = true;
      const result = await window.notchman.upgrade(button.dataset.upgrade);
      button.textContent = result.ok ? 'Finish in your browser' : label;
      button.disabled = false;
      if (!result.ok) alert(result.message || "Checkout couldn't be opened. Please try again.");
      if (result.ok) waitForPayment(button.dataset.upgrade);
    });
  }
  $('refreshPlan').addEventListener('click', async () => {
    $('refreshPlan').textContent = 'Checking…';
    await loadUsage();
    $('refreshPlan').textContent = "I've paid: refresh";
  });

  // --- History ----------------------------------------------------------------

  const words = (text) => (text ? text.trim().split(/\s+/).filter(Boolean).length : 0);

  function when(at) {
    const mins = Math.round((Date.now() - at) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function stats(items) {
    const spoken = items.reduce((n, i) => n + words(i.spoken), 0);
    // Reading at ~250 words a minute vs. the TL;DR heard instead.
    const saved = items.filter((i) => i.action === 'tldr' && i.original)
      .reduce((n, i) => n + Math.max(0, words(i.original) - words(i.spoken)), 0);
    $('statListens').textContent = items.length.toLocaleString();
    $('statMinutes').textContent = Math.round(spoken / 150).toLocaleString();
    $('statSaved').textContent = `${Math.round(saved / 250).toLocaleString()} min`;
  }

  function row(item, { compact = false } = {}) {
    const li = document.createElement('li');
    if (item.id === selectedId && !compact) li.classList.add('selected');
    const play = Object.assign(document.createElement('button'), { className: 'play', textContent: '▶', title: 'Play again' });
    play.addEventListener('click', (event) => { event.stopPropagation(); window.notchman.replay(item.id); });
    const what = Object.assign(document.createElement('div'), { className: 'what' });
    what.append(
      Object.assign(document.createElement('div'), { className: 'title', textContent: item.title || item.spoken.slice(0, 80) }),
      Object.assign(document.createElement('div'), { className: 'meta', textContent: `${item.source} · ${when(item.at)}` }),
    );
    const mode = Object.assign(document.createElement('span'), { className: 'mode', textContent: item.action === 'tldr' ? 'TL;DR' : 'Read' });
    li.append(play, what, mode);
    if (!compact) {
      const remove = Object.assign(document.createElement('button'), { className: 'remove', textContent: '×', title: 'Remove' });
      remove.addEventListener('click', async (event) => {
        event.stopPropagation();
        historyItems = await window.notchman.removeHistory(item.id);
        if (selectedId === item.id) selectedId = null;
        render();
      });
      li.append(remove);
    }
    li.addEventListener('click', () => { selectedId = item.id; show('history'); render(); });
    return li;
  }

  /** The TL;DR's key points, as a highlighted list (newer TL;DRs have them). */
  function keyPoints(item) {
    if (!Array.isArray(item.highlights) || !item.highlights.length) return [];
    const list = Object.assign(document.createElement('ul'), { className: 'key-points' });
    list.replaceChildren(...item.highlights.map((h) => Object.assign(document.createElement('li'), { textContent: h })));
    return [Object.assign(document.createElement('h2'), { textContent: 'Key points' }), list];
  }

  function detail() {
    const item = historyItems.find((i) => i.id === selectedId);
    const box = $('detail');
    if (!item) {
      box.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Choose something on the left to see what was said.' }));
      return;
    }
    const buttons = Object.assign(document.createElement('div'), { className: 'buttons' });
    const play = Object.assign(document.createElement('button'), { className: 'primary small', textContent: item.action === 'tldr' ? '▶ Play TL;DR' : '▶ Play' });
    play.addEventListener('click', () => window.notchman.replay(item.id));
    const copy = Object.assign(document.createElement('button'), { className: 'secondary small', textContent: 'Copy text' });
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(item.spoken);
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy text'; }, 1500);
    });
    buttons.append(play, copy);
    const parts = [
      Object.assign(document.createElement('h3'), { textContent: item.title || 'Untitled' }),
      Object.assign(document.createElement('p'), { className: 'muted', textContent: `${item.action === 'tldr' ? 'TL;DR' : 'Read'} · ${item.source} · ${new Date(item.at).toLocaleString()}` }),
      ...keyPoints(item),
      Object.assign(document.createElement('div'), { className: 'text', textContent: item.spoken }),
      buttons,
    ];
    if (item.action === 'tldr' && item.original) {
      const h = Object.assign(document.createElement('h2'), { textContent: 'Original' });
      h.style.marginTop = '18px';
      parts.push(h, Object.assign(document.createElement('div'), { className: 'text muted', textContent: item.original }));
    }
    box.replaceChildren(...parts);
  }

  function render() {
    const query = $('search').value.trim().toLowerCase();
    const shown = query
      ? historyItems.filter((i) => `${i.title} ${i.source} ${i.spoken} ${i.original || ''}`.toLowerCase().includes(query))
      : historyItems;
    const empty = (text) => Object.assign(document.createElement('li'), { className: 'empty', textContent: text });
    $('history').replaceChildren(...(shown.length ? shown.map((i) => row(i)) : [empty(query ? 'Nothing matches.' : 'Nothing yet. Copy something and press the shortcut.')]));
    $('recent').replaceChildren(...(historyItems.length ? historyItems.slice(0, 5).map((i) => row(i, { compact: true })) : [empty('Nothing yet. Copy something and press the shortcut.')]));
    stats(historyItems);
    detail();
  }

  async function loadHistory() {
    historyItems = await window.notchman.history();
    render();
  }

  $('search').addEventListener('input', render);
  $('clearHistory').addEventListener('click', async () => {
    if (confirm('Clear your listening history on this computer?')) {
      historyItems = await window.notchman.clearHistory();
      selectedId = null;
      render();
    }
  });

  // --- Updates ----------------------------------------------------------------

  let update = null;

  function showUpdate(info) {
    if (info && info.community) {
      $('updateStatus').textContent = 'Community edition: to update, run git pull and npm install.';
      return;
    }
    update = info && info.available ? info : null;
    $('updateDot').classList.toggle('gone', !update);
    $('updateBanner').classList.toggle('gone', !update);
    $('installUpdate').classList.toggle('gone', !update);
    if (update) {
      const label = update.ready ? 'Restart to update' : 'Update now';
      for (const b of [$('installUpdate'), $('bannerInstall')]) if (!b.disabled) b.textContent = label;
      $('updateText').textContent = update.ready
        ? `Notchman ${update.version} is downloaded and installs by itself next time Notchman starts.`
        : `Notchman ${update.version} is ready (you have ${update.current}).`;
      $('updateStatus').textContent = update.ready
        ? `Version ${update.version} is downloaded. It installs by itself next time Notchman starts, or restart now.`
        : `Version ${update.version} is available.`;
    } else if (info && info.ok) {
      $('updateStatus').textContent = "You're up to date.";
    } else if (info) {
      $('updateStatus').textContent = "Couldn't check for updates. Check your connection.";
    }
  }

  async function checkUpdates() {
    $('updateStatus').textContent = 'Checking for updates…';
    showUpdate(await window.notchman.checkUpdate());
  }

  async function install() {
    const busy = update && update.ready ? 'Restarting…' : 'Downloading…';
    for (const b of [$('installUpdate'), $('bannerInstall')]) { b.disabled = true; b.textContent = busy; }
    const result = await window.notchman.installUpdate();
    if (!result.ok) {
      alert(result.message || "The update couldn't be downloaded. Try again later.");
      for (const b of [$('installUpdate'), $('bannerInstall')]) { b.disabled = false; b.textContent = 'Update now'; }
    }
  }

  $('checkUpdate').addEventListener('click', checkUpdates);
  $('installUpdate').addEventListener('click', install);
  $('bannerInstall').addEventListener('click', install);

  // --- Start ------------------------------------------------------------------

  window.notchman.onDashboard(({ tab, changed }) => {
    if (tab) show(tab);
    if (changed) { loadHistory(); loadUsage(); }
  });
  // --- Your API keys (Community edition) -------------------------------------

  const KEY_NAMES = ['GROQ_API_KEY', 'ELEVENLABS_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY'];
  const SOURCES = { environment: 'Set by an environment variable', '.env file': 'Set in your .env file', saved: 'Saved ✓' };

  function showKeys(described) {
    if (!described) return;
    for (const name of KEY_NAMES) {
      const where = described[name];
      $(`src-${name}`).textContent = where ? SOURCES[where] || '' : '';
    }
    $('keysStatus').textContent = described.GROQ_API_KEY || described.LLM_BASE_URL
      ? 'Ready: copy something and press your TL;DR shortcut.'
      : 'Add your Groq key to start.';
  }

  $('saveKeys').addEventListener('click', async () => {
    const changes = {};
    for (const name of KEY_NAMES) {
      const value = $(`key-${name}`).value.trim();
      if (value) changes[name] = value;
    }
    if (!Object.keys(changes).length) {
      $('keysStatus').textContent = 'Paste a key first.';
      return;
    }
    showKeys(await window.notchman.saveKeys(changes));
    for (const name of KEY_NAMES) $(`key-${name}`).value = '';
  });

  window.notchman.getSettings().then((s) => {
    if (s.edition === 'community') {
      document.body.classList.add('community');
      showKeys(s.keys);
    }
    const pretty = (key) => key.replace('CommandOrControl', s.platform === 'darwin' ? '⌘' : 'Ctrl').replace(/\+/g, s.platform === 'darwin' ? '' : '+');
    $('homeTldrKey').textContent = pretty(s.settings.tldrShortcut);
    $('homeReadKey').textContent = pretty(s.settings.readShortcut);
    $('installId').textContent = s.settings.installId || '';
    $('versionNumber').textContent = s.version;
    $('platformName').textContent = s.platform === 'darwin' ? 'Mac' : s.platform === 'win32' ? 'Windows' : 'your computer';
  });
  window.notchman.checkUpdate().then(showUpdate);
  show(new URLSearchParams(location.search).get('tab') || 'home');
})();
