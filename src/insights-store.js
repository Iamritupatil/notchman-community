'use strict';

// Your Notchman insights, kept on this computer (insights.json in the app's
// data folder): per day, how many TL;DRs and reads you listened to, how many
// words they covered and how many you heard, and which apps they came from.
// Counts only, never the text. History keeps the newest 200 listens; these
// totals keep counting for good.

const fs = require('node:fs');
const path = require('node:path');

/** Typical silent reading and listening speeds (words per minute). */
const READING_WPM = 238;
const LISTENING_WPM = 155;

const words = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;

/** The local calendar day of a time, as YYYY-MM-DD. */
function dayOf(time) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return dayOf(new Date(y, m - 1, d + n, 12));
}

function emptyDay() {
  return { tldrs: 0, reads: 0, wordsIn: 0, wordsHeard: 0, minutesHeard: 0 };
}

function createInsightsStore(directory, { history } = {}) {
  const file = path.join(directory, 'insights.json');
  let data = { days: {}, apps: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed.days === 'object') data = { days: parsed.days, apps: parsed.apps || {} };
  } catch {
    // First run of this version: start from what History already has.
    for (const item of (history?.list() || []).slice().reverse()) record(item, { save: false });
    save();
  }

  function save() {
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data));
    } catch { /* insights are optional */ }
  }

  /** One listen: { action, spoken, original, app, at?, speed? }. */
  function record({ action, spoken, original, app, at = Date.now(), speed = 1 }, { save: persist = true } = {}) {
    const day = dayOf(at);
    const entry = data.days[day] || (data.days[day] = emptyDay());
    const heard = words(spoken);
    if (action === 'read') entry.reads += 1; else entry.tldrs += 1;
    entry.wordsIn += words(original) || heard;
    entry.wordsHeard += heard;
    entry.minutesHeard = Math.round((entry.minutesHeard + heard / (LISTENING_WPM * (speed || 1))) * 100) / 100;
    const name = typeof app === 'string' && app ? app : 'other';
    data.apps[name] = (data.apps[name] || 0) + 1;
    if (persist) save();
  }

  /** Everything the Insights screen shows, as of `now`. */
  function summary(now = Date.now()) {
    const today = dayOf(now);
    const listens = (d) => (d ? d.tldrs + d.reads : 0);
    const totals = emptyDay();
    let activeDays = 0;
    let busiest = null;
    for (const [day, d] of Object.entries(data.days)) {
      for (const key of Object.keys(totals)) totals[key] += d[key] || 0;
      if (listens(d) > 0) activeDays += 1;
      if (!busiest || listens(d) > busiest.listens) busiest = { day, listens: listens(d) };
    }
    // Streak: days in a row with a listen, up to today (or yesterday, so the
    // streak doesn't look lost before you've listened today).
    let streak = 0;
    let cursor = listens(data.days[today]) > 0 ? today : addDays(today, -1);
    while (listens(data.days[cursor]) > 0) { streak += 1; cursor = addDays(cursor, -1); }
    let best = 0;
    let run = 0;
    let previous = null;
    for (const day of Object.keys(data.days).filter((k) => listens(data.days[k]) > 0).sort()) {
      run = previous && addDays(previous, 1) === day ? run + 1 : 1;
      best = Math.max(best, run);
      previous = day;
    }
    // The last 52 weeks, a column per week starting on Sunday, like GitHub.
    const start = addDays(today, -(7 * 51 + new Date(now).getDay()));
    const grid = [];
    for (let day = start; day <= today; day = addDays(day, 1)) grid.push({ day, listens: listens(data.days[day]) });
    const minutesToRead = totals.wordsIn / READING_WPM;
    return {
      tldrs: totals.tldrs,
      reads: totals.reads,
      listens: totals.tldrs + totals.reads,
      wordsIn: totals.wordsIn,
      wordsHeard: totals.wordsHeard,
      minutesHeard: Math.round(totals.minutesHeard * 10) / 10,
      // Time saved: reading everything you covered, minus the time you spent listening.
      minutesSaved: Math.max(0, Math.round(minutesToRead - totals.minutesHeard)),
      // How fast you get through text by listening to TL;DRs, against reading it.
      wordsPerMinute: totals.minutesHeard > 0.5 ? Math.round(totals.wordsIn / totals.minutesHeard) : null,
      readingWordsPerMinute: READING_WPM,
      streak,
      bestStreak: best,
      activeDays,
      busiest,
      today: data.days[today] ? { ...data.days[today] } : emptyDay(),
      grid,
      apps: Object.entries(data.apps).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([app, count]) => ({ app, count })),
    };
  }

  return { record, summary, clear() { data = { days: {}, apps: {} }; save(); } };
}

module.exports = { createInsightsStore, dayOf, READING_WPM, LISTENING_WPM };
