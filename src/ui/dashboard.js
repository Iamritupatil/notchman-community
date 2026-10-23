'use strict';

// The Notchman window: Home (quick actions, stats, recent), History (search,
// full text, replay), Plan (upgrade), About (updates, help, uninstall). The
// Settings page's controls are drawn by settings.js.

(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => Object.assign(document.createElement(tag), className ? { className } : {}, text != null ? { textContent: text } : {});
  const PLAN_NAMES = { free: 'Free', pro: 'Pro', proplus: 'Pro+' };
  let historyItems = [];
  let selectedId = null;
  let community = false;
  // Upgrade isn't offered until they've listened to something all the way through.
  let listenedOnce = true;

  function show(tab) {
    for (const button of document.querySelectorAll('.nav-item')) button.classList.toggle('active', button.dataset.tab === tab);
    for (const panel of document.querySelectorAll('.panel')) panel.classList.toggle('active', panel.dataset.panel === tab);
    if (tab === 'home' || tab === 'plan') loadUsage();
    if (tab === 'plan' && !community) window.notchman.track('paywall_viewed');
    if (tab === 'home' || tab === 'history') loadHistory();
    if (tab === 'about') checkUpdates();
  }

  for (const button of document.querySelectorAll('.nav-item')) button.addEventListener('click', () => show(button.dataset.tab));
  for (const link of document.querySelectorAll('[data-goto]')) link.addEventListener('click', () => show(link.dataset.goto));
  $('sideUpgrade').addEventListener('click', () => window.notchman.track('pro_button_tap'));
  for (const action of document.querySelectorAll('[data-action]')) {
    action.addEventListener('click', () => window.notchman.dashboardAction(action.dataset.action));
  }

  // --- A small dialog instead of the browser's alert() and confirm() -------------

  /** Resolves true if the person confirms. `cancel: null` shows only one button. */
  function ask({ title, body, confirm = 'OK', cancel = 'Cancel', danger = false }) {
    const sheet = $('sheet');
    $('sheetTitle').textContent = title;
    $('sheetBody').replaceChildren(...[].concat(body || []).map((text) => el('p', '', text)));
    $('sheetConfirm').textContent = confirm;
    $('sheetConfirm').className = `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`;
    $('sheetCancel').textContent = cancel || '';
    $('sheetCancel').classList.toggle('gone', !cancel);
    sheet.showModal();
    return new Promise((resolve) => {
      const done = (answer) => {
        $('sheetConfirm').onclick = null;
        $('sheetCancel').onclick = null;
        sheet.onclose = null;
        if (sheet.open) sheet.close();
        resolve(answer);
      };
      $('sheetConfirm').onclick = () => done(true);
      $('sheetCancel').onclick = () => done(false);
      sheet.onclose = () => done(false);
    });
  }
  const tell = (title, body) => ask({ title, body, cancel: null });

  // The buyer's email, asked before checkout: it's filled in at Dodo and lets
  // us send the receipt and help if anything goes wrong. Remembered for next time.
  let savedEmail = '';
  const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
  function askEmail(planName) {
    const sheet = $('sheet');
    const input = el('input', 'input');
    Object.assign(input, { type: 'email', placeholder: 'you@example.com', autocomplete: 'email', value: savedEmail, spellcheck: false });
    const error = el('p', 'field-error gone', "That email doesn't look right.");
    const privacy = el('p', 'caption');
    privacy.append("For your receipt, and so we can help if anything goes wrong. We never send spam. ",
      Object.assign(el('a', '', 'Privacy Policy'), { href: 'https://notchman.app/privacy', target: '_blank' }));
    $('sheetTitle').textContent = `Get Notchman ${planName}`;
    $('sheetBody').replaceChildren(el('p', '', 'Your email'), input, error, privacy);
    $('sheetBody').classList.add('form');
    $('sheetConfirm').textContent = 'Continue to payment';
    $('sheetConfirm').className = 'btn btn-primary';
    $('sheetCancel').textContent = 'Cancel';
    $('sheetCancel').classList.remove('gone');
    sheet.showModal();
    input.focus();
    input.select();
    return new Promise((resolve) => {
      const done = (answer) => {
        $('sheetConfirm').onclick = null;
        $('sheetCancel').onclick = null;
        input.onkeydown = null;
        sheet.onclose = null;
        $('sheetBody').classList.remove('form');
        if (sheet.open) sheet.close();
        resolve(answer);
      };
      const submit = () => {
        const email = input.value.trim();
        if (!EMAIL.test(email)) {
          error.classList.remove('gone');
          input.focus();
          return;
        }
        savedEmail = email;
        done(email);
      };
      input.oninput = () => error.classList.add('gone');
      input.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } };
      $('sheetConfirm').onclick = submit;
      $('sheetCancel').onclick = () => done(null);
      sheet.onclose = () => done(null);
    });
  }

  // --- Plan and usage ---------------------------------------------------------

  const percent = (used, limit) => (limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0);
  const chars = (n) => Number(n || 0).toLocaleString();
  const minutes = (c) => Math.max(0, Math.round(c / 900));

  async function loadUsage() {
    if (!community) listenedOnce = (await window.notchman.getSettings()).listenedOnce !== false;
    const usage = await window.notchman.usage();
    if (usage.ok && usage.plan === 'community') {
      $('planLead').textContent = 'Free for personal, non-commercial use.';
      return usage;
    }
    if (!usage.ok) {
      $('voiceNote').textContent = "Couldn't load your plan";
      $('planLead').textContent = "Couldn't load your plan. Check your connection.";
      $('sideVoice').textContent = "Couldn't load your plan";
      // Usually a moment without internet: try again shortly.
      clearTimeout(loadUsage.retry);
      loadUsage.retry = setTimeout(loadUsage, 15000);
      return usage;
    }
    const plan = PLAN_NAMES[usage.plan] || 'Free';
    const left = Math.max(0, (usage.voiceLimit || 0) - (usage.voiceUsed || 0));
    const period = usage.voicePeriod === 'day' ? 'today' : usage.voicePeriod === 'trial' ? 'in your preview' : 'this month';
    $('planChip').textContent = `${plan} plan`;
    $('sideUpgrade').classList.toggle('gone', usage.plan === 'proplus' || (usage.plan === 'free' && !listenedOnce));
    $('sideMeter').style.width = `${100 - percent(usage.voiceUsed, usage.voiceLimit)}%`;
    $('sideVoice').textContent = usage.voiceLimit ? `About ${minutes(left)} min of Notchman voice left` : 'Free voice on this computer';
    $('voiceCount').textContent = usage.voiceLimit ? `${minutes(left)} min` : '–';
    $('voiceMeter').style.width = `${100 - percent(usage.voiceUsed, usage.voiceLimit)}%`;
    $('voiceNote').textContent = usage.voiceLimit ? 'Notchman voice left' : 'Free voice on this computer';
    $('voiceNote').title = usage.voiceLimit ? `${chars(left)} characters left ${period}` : '';
    $('planLead').textContent = usage.plan === 'free'
      ? (listenedOnce
        ? "You're on Free. TL;DRs always work with the free voice on your computer. Upgrade for the natural Notchman voice."
        : "You're on Free. Try it first: select some text anywhere and press your TL;DR shortcut. Upgrade only if you want more.")
      : `You're on ${plan}, with about ${minutes(left)} min of Notchman voice left ${period}.`;
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
  // (Dodo tells our server within seconds). Up to 30 minutes.
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
        $('planLead').textContent = `You're on Notchman ${PLAN_NAMES[usage.plan]}. The natural Notchman voice is on.`;
        new Notification(`Notchman ${PLAN_NAMES[usage.plan]} is active`, { body: 'The natural Notchman voice is on.' });
      }
    }, 6000);
  }

  for (const button of document.querySelectorAll('[data-upgrade]')) {
    button.addEventListener('click', async () => {
      const email = await askEmail(PLAN_NAMES[button.dataset.upgrade]);
      if (!email) return;
      const label = button.textContent;
      button.textContent = 'Opening checkout…';
      button.disabled = true;
      const result = await window.notchman.upgrade(button.dataset.upgrade, email);
      button.textContent = result.ok ? 'Finish in your browser' : label;
      button.disabled = false;
      if (!result.ok) tell("Checkout didn't open", result.message || 'Please try again.');
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
    if (mins < 1) return 'Just now';
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

  function iconButton(name, title, className = '') {
    const button = el('button', `icon-btn ${className}`.trim());
    button.title = title;
    button.setAttribute('aria-label', title);
    button.append(window.icon(name));
    return button;
  }

  function row(item, { compact = false } = {}) {
    const li = el('li');
    if (item.id === selectedId && !compact) li.classList.add('selected');
    const play = iconButton('play', 'Play again', 'accent');
    play.addEventListener('click', (event) => { event.stopPropagation(); window.notchman.replay(item.id); });
    const what = el('div', 'what');
    what.append(el('div', 'title', item.title || item.spoken.slice(0, 80)), el('div', 'meta', `${item.source} · ${when(item.at)}`));
    li.append(play, what, el('span', item.action === 'tldr' ? 'tag' : 'tag tag-quiet', item.action === 'tldr' ? 'TL;DR' : 'Read'));
    if (!compact) {
      const remove = iconButton('trash', 'Remove from history', 'remove');
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

  function detail() {
    const item = historyItems.find((i) => i.id === selectedId);
    const box = $('detail');
    if (!item) {
      box.replaceChildren(el('p', 'placeholder', historyItems.length ? 'Choose something on the left to see what was said.' : 'What you listen to shows up here.'));
      return;
    }
    const parts = [
      el('h3', '', item.title || 'Untitled'),
      el('p', 'caption meta-line', `${item.source} · ${new Date(item.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`),
    ];
    // Newer TL;DRs come with their key points.
    if (Array.isArray(item.highlights) && item.highlights.length) {
      const list = el('ul', 'key-points');
      list.replaceChildren(...item.highlights.map((h) => el('li', '', h)));
      parts.push(el('h4', 'section-title', 'Key points'), list);
    }
    parts.push(el('h4', 'section-title', item.action === 'tldr' ? 'TL;DR' : 'Text'), el('div', 'text', item.spoken));

    const buttons = el('div', 'buttons');
    const play = el('button', 'btn btn-primary btn-sm');
    play.append(window.icon('play'), document.createTextNode(item.action === 'tldr' ? 'Play TL;DR' : 'Play'));
    play.addEventListener('click', () => window.notchman.replay(item.id));
    const copy = el('button', 'btn btn-secondary btn-sm');
    const copyLabel = document.createTextNode('Copy text');
    copy.append(window.icon('copy'), copyLabel);
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(item.spoken);
      copyLabel.textContent = 'Copied';
      setTimeout(() => { copyLabel.textContent = 'Copy text'; }, 1500);
    });
    buttons.append(play, copy);
    parts.push(buttons);

    if (item.action === 'tldr' && item.original) parts.push(el('h4', 'section-title', 'Original'), el('div', 'text original', item.original));
    box.replaceChildren(...parts);
  }

  function render() {
    const query = $('search').value.trim().toLowerCase();
    const shown = query
      ? historyItems.filter((i) => `${i.title} ${i.source} ${i.spoken} ${i.original || ''}`.toLowerCase().includes(query))
      : historyItems;
    const empty = (text) => el('li', 'empty', text);
    const nothingYet = 'Nothing yet. Select some text and press your TL;DR shortcut.';
    $('history').replaceChildren(...(shown.length ? shown.map((i) => row(i)) : [empty(query ? 'Nothing matches.' : nothingYet)]));
    $('recent').replaceChildren(...(historyItems.length ? historyItems.slice(0, 5).map((i) => row(i, { compact: true })) : [empty(nothingYet)]));
    $('clearHistory').classList.toggle('gone', !historyItems.length);
    stats(historyItems);
    detail();
  }

  async function loadHistory() {
    historyItems = await window.notchman.history();
    render();
  }

  $('search').addEventListener('input', render);
  $('clearHistory').addEventListener('click', async () => {
    const yes = await ask({ title: 'Clear your history?', body: 'Everything you listened to on this computer is removed. This can’t be undone.', confirm: 'Clear all', danger: true });
    if (!yes) return;
    historyItems = await window.notchman.clearHistory();
    selectedId = null;
    render();
  });

  // --- Updates ----------------------------------------------------------------

  let update = null;

  function showUpdate(info) {
    if (info && info.store) {
      $('updateStatus').textContent = 'Updates come from the Microsoft Store.';
      $('checkUpdate').classList.add('gone');
      return;
    }
    update = info && info.available ? info : null;
    $('updateDot').classList.toggle('gone', !update);
    $('updateBanner').classList.toggle('gone', !update);
    $('installUpdate').classList.toggle('gone', !update);
    if (update) {
      const label = update.ready ? 'Restart to update' : 'Update now';
      for (const b of [$('installUpdate'), $('bannerInstall')]) if (!b.disabled) b.textContent = label;
      if (community) {
        const changes = `${update.changes} new change${update.changes === 1 ? '' : 's'}`;
        $('updateText').textContent = `A new version of Notchman Community is on GitHub (${changes}). Update now, and Notchman restarts.`;
        $('updateStatus').textContent = `${changes} on GitHub.`;
        return;
      }
      $('updateText').textContent = update.ready
        ? `Notchman ${update.version} is downloaded. It installs next time Notchman starts.`
        : `Notchman ${update.version} is available. You have ${update.current}.`;
      $('updateStatus').textContent = update.ready
        ? `Version ${update.version} is downloaded and installs next time Notchman starts.`
        : `Version ${update.version} is available.`;
    } else if (info && info.ok) {
      $('updateStatus').textContent = "You're up to date.";
    } else if (info) {
      $('updateStatus').textContent = info.message || "Couldn't check for updates. Check your connection.";
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
      tell("The update didn't download", result.message || 'Try again later.');
      for (const b of [$('installUpdate'), $('bannerInstall')]) { b.disabled = false; b.textContent = 'Update now'; }
    }
  }

  $('checkUpdate').addEventListener('click', checkUpdates);
  $('installUpdate').addEventListener('click', install);
  $('bannerInstall').addEventListener('click', install);

  // --- Uninstall --------------------------------------------------------------

  let uninstallKind = null;
  window.notchman.uninstallInfo().then((info) => {
    uninstallKind = info;
    if (info.kind === 'source') {
      $('uninstallNote').textContent = 'Removes its history, settings and startup entry. Then you delete its folder.';
    }
    if (info.kind === 'store') {
      $('uninstallNote').textContent = 'Removes your history and settings, then opens Windows Settings to remove the app.';
    }
  });

  $('uninstall').addEventListener('click', async () => {
    const info = uninstallKind || { kind: 'installed' };
    const body = info.kind === 'source'
      ? ['Notchman removes its history, settings and startup entry from this computer, then closes.',
        `Then delete the folder you downloaded it to${info.folder ? `: ${info.folder}` : ''}. Notchman opens it for you.`]
      : info.kind === 'store'
      ? ['Notchman removes your listening history and settings, then closes.',
        'Windows Settings opens on Installed apps: choose Notchman, then Uninstall.']
      : ['Notchman, your listening history and settings are removed from this computer.',
        community ? '' : 'Your subscription isn’t cancelled by uninstalling. Cancel it from your receipt email.'].filter(Boolean);
    const yes = await ask({ title: 'Uninstall Notchman?', body, confirm: 'Uninstall', danger: true });
    if (!yes) return;
    $('uninstall').disabled = true;
    $('uninstall').textContent = 'Uninstalling…';
    const result = await window.notchman.uninstall();
    if (!result || !result.ok) {
      $('uninstall').disabled = false;
      $('uninstall').textContent = 'Uninstall…';
      tell("Notchman couldn't uninstall", (result && result.message) || 'Try again, or remove it from Windows Settings → Apps.');
    }
  });

  // --- Start ------------------------------------------------------------------

  // The Shiba on Home says hello each time the window opens.
  const heroShiba = window.createShiba($('heroShiba'), { scale: 3, variant: 'head' });
  heroShiba.setMood('hello');

  window.notchman.onDashboard(({ tab, changed }) => {
    if (tab) show(tab);
    if (changed) { loadHistory(); loadUsage(); }
  });

  window.notchman.getSettings().then((s) => {
    community = s.edition === 'community';
    if (community) {
      document.body.classList.add('community');
      $('historyLead').textContent = "Everything you've listened to on this computer.";
    }
    const pretty = (key) => key.replace('CommandOrControl', s.platform === 'darwin' ? '⌘' : 'Ctrl').replace(/\+/g, s.platform === 'darwin' ? '' : '+');
    $('homeTldrKey').textContent = pretty(s.settings.tldrShortcut);
    $('homeReadKey').textContent = pretty(s.settings.readShortcut);
    $('installId').textContent = s.settings.installId || '';
    savedEmail = s.settings.email || '';
    $('versionNumber').textContent = s.version;
  });
  window.notchman.checkUpdate().then(showUpdate);
  show(new URLSearchParams(location.search).get('tab') || 'home');
})();
