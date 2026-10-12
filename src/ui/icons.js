'use strict';

// Notchman's icons: one set, drawn on a 24-unit grid with a 1.75 stroke, so
// every window uses the same shapes. In HTML write <i data-icon="home"></i>;
// from code call window.icon('home').

(() => {
  const ICONS = {
    home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
    history: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.6 2.2"/>',
    plan: '<path d="m12 4.5 2.3 4.7 5.2.8-3.8 3.6.9 5.2-4.6-2.4-4.6 2.4.9-5.2L4.5 10l5.2-.8z"/>',
    settings: '<path d="M4 7h8.5M17.5 7H20M4 17h2.5M11.5 17H20"/><circle cx="15" cy="7" r="2.5"/><circle cx="9" cy="17" r="2.5"/>',
    info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
    tldr: '<path d="M11 4.5c.7 3.9 2.6 5.8 6.5 6.5-3.9.7-5.8 2.6-6.5 6.5-.7-3.9-2.6-5.8-6.5-6.5 3.9-.7 5.8-2.6 6.5-6.5z"/><path d="M18 15.5c.3 1.4 1 2.1 2.5 2.5-1.4.3-2.2 1-2.5 2.5-.3-1.5-1.1-2.2-2.5-2.5 1.4-.4 2.2-1.1 2.5-2.5z"/>',
    read: '<path d="M4.5 9.5h3L12 6v12l-4.5-3.5h-3z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"/>',
    pick: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M8.5 10h7M8.5 14h4.5"/>',
    close: '<path d="m7 7 10 10M17 7 7 17"/>',
    play: '<path class="fill" d="M8.5 6.2v11.6a.8.8 0 0 0 1.2.7l9.3-5.8a.8.8 0 0 0 0-1.4L9.7 5.5a.8.8 0 0 0-1.2.7z"/>',
    pause: '<rect class="fill" x="7" y="5.5" width="3.6" height="13" rx="1"/><rect class="fill" x="13.4" y="5.5" width="3.6" height="13" rx="1"/>',
    back: '<path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M6.5 3.5v3.8h3.8"/>',
    forward: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M17.5 3.5v3.8h-3.8"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M7 7l.8 11.2a1 1 0 0 0 1 .8h6.4a1 1 0 0 0 1-.8L17 7M10.5 11v4.5M13.5 11v4.5"/>',
    check: '<path d="m5.5 12.5 4 4 9-9"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m19.5 19.5-4-4"/>',
    external: '<path d="M13.5 5H19v5.5M19 5l-8 8M17 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4.5"/>',
    key: '<circle cx="8" cy="15.5" r="3.5"/><path d="m10.5 13 8.5-8.5M15.5 8l2.5 2.5M13.5 10l1.5 1.5"/>',
    shield: '<path d="M12 4 18.5 6.5V11c0 4.2-2.8 7.4-6.5 8.5-3.7-1.1-6.5-4.3-6.5-8.5V6.5z"/>',
    lock: '<rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    download: '<path d="M12 4.5v10M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4.5 7 7.5 6 7.5-6"/>',
    chevron: '<path d="m10 6.5 5.5 5.5-5.5 5.5"/>',
    wave: '<path d="M4 11v2M8 8v8M12 5v14M16 9v6M20 11v2"/>',
    folder: '<path d="M4 7.5a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
    spark: '<path d="M12 4.5v3M12 16.5v3M4.5 12h3M16.5 12h3M6.7 6.7l2.1 2.1M15.2 15.2l2.1 2.1M6.7 17.3l2.1-2.1M15.2 8.8l2.1-2.1"/>',
  };

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon');
    svg.innerHTML = ICONS[name] || '';
    return svg;
  }

  function fill(root = document) {
    for (const slot of root.querySelectorAll('i[data-icon]')) slot.replaceWith(icon(slot.dataset.icon));
  }

  window.icon = icon;
  window.fillIcons = fill;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => fill());
  else fill();
})();
