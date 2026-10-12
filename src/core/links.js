'use strict';

// Fetches a copied link and returns the useful text behind it: the post or
// article, not the page around it.
//
//   lnkd.in / t.co  → followed to the real page first
//   X / Twitter     → X's public embed (oEmbed)
//   Reddit          → the post and its top comments (Reddit's JSON)
//   LinkedIn        → the public post's structured data, then its embed page
//   anything else   → the article text (Mozilla Readability, as in Firefox's Reader View)
//
// A page that needs signing in fails with a plain message: the link was fine,
// the site just wouldn't show it.

const { parseHTML } = require('linkedom');
const { Readability } = require('@mozilla/readability');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

class LinkError extends Error {}

function hostOf(url) {
  return url.hostname.replace(/^www\./, '').toLowerCase();
}

/** "LinkedIn", "Reddit", "X" or the site's domain. */
function sourceName(url) {
  const host = hostOf(url);
  if (host.endsWith('linkedin.com')) return 'LinkedIn';
  if (host.endsWith('reddit.com') || host === 'redd.it') return 'Reddit';
  if (['x.com', 'twitter.com', 'mobile.twitter.com', 'mobile.x.com'].includes(host)) return 'X';
  if (host.endsWith('chatgpt.com') || host.endsWith('openai.com')) return 'ChatGPT';
  if (host.endsWith('claude.ai')) return 'Claude';
  return host;
}

function isPostSource(name) {
  return ['LinkedIn', 'Reddit', 'X'].includes(name);
}

/**
 * @param {URL} url
 * @param {{fetch?: typeof fetch, render?: (url: string) => Promise<string>}} [deps]
 *   `render` loads a page in a hidden browser window (for pages built with JavaScript).
 * @returns {Promise<{text: string, title: string|null, source: string, url: string}>}
 */
async function resolve(url, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const target = await expandShortLink(url, fetchImpl);
  const source = sourceName(target);
  let result;
  if (source === 'X' && /\/status\//.test(target.pathname)) result = await xPost(target, fetchImpl);
  else if (source === 'Reddit') result = await redditPost(target, fetchImpl);
  else if (source === 'LinkedIn') result = await linkedInPost(target, fetchImpl);
  else result = await article(target, fetchImpl, deps.render);
  return { ...result, source, url: target.href };
}

async function get(url, fetchImpl, accept = 'text/html,application/xhtml+xml') {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new LinkError("Couldn't load that link. Check your connection.");
  }
  return response;
}

async function expandShortLink(url, fetchImpl) {
  const host = hostOf(url);
  if (host !== 'lnkd.in' && host !== 't.co') return url;
  const response = await get(url.href, fetchImpl);
  const final = response.url ? new URL(response.url) : url;
  if (hostOf(final) !== host) return final;
  const target = interstitialTarget(await response.text());
  return target ? new URL(target) : url;
}

/** The destination on LinkedIn's or X's "you're leaving" page. */
function interstitialTarget(html) {
  const patterns = [
    /<a[^>]+data-tracking-control-name=["']external_url_click["'][^>]+href=["'](https?:\/\/[^"']+)["']/i,
    /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]+data-tracking-control-name=["']external_url_click["']/i,
    /<meta[^>]+http-equiv=["']refresh["'][^>]+url=([^"'>\s]+)/i,
    /<title>\s*(https?:\/\/[^<\s]+)\s*<\/title>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeEntities(match[1]);
  }
  return null;
}

// --- X -------------------------------------------------------------------

async function xPost(url, fetchImpl) {
  const api = new URL('https://publish.twitter.com/oembed');
  api.searchParams.set('url', url.href);
  api.searchParams.set('omit_script', '1');
  api.searchParams.set('dnt', 'true');
  const response = await get(api.href, fetchImpl, 'application/json');
  if (!response.ok) throw new LinkError("Couldn't access this X post automatically.");
  const post = parseXOEmbed(await response.json());
  if (!post) throw new LinkError("Couldn't access this X post automatically.");
  return post;
}

function parseXOEmbed(json) {
  const paragraph = json && typeof json.html === 'string' ? json.html.match(/<p[^>]*>([\s\S]*?)<\/p>/i) : null;
  if (!paragraph) return null;
  const text = decodeEntities(paragraph[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim();
  if (!text) return null;
  return { text, title: json.author_name ? `Post by ${json.author_name}` : null };
}

// --- Reddit --------------------------------------------------------------

async function redditPost(url, fetchImpl) {
  const api = new URL(url.href);
  api.pathname = api.pathname.replace(/\/+$/, '') + '.json';
  api.search = '';
  api.searchParams.set('limit', '8');
  api.searchParams.set('raw_json', '1');
  const response = await get(api.href, fetchImpl, 'application/json');
  if (!response.ok) throw new LinkError("Couldn't access this Reddit post automatically.");
  const post = parseReddit(await response.json());
  if (!post) throw new LinkError("Couldn't access this Reddit post automatically.");
  return post;
}

function parseReddit(json) {
  const listing = Array.isArray(json) ? json : null;
  const post = listing?.[0]?.data?.children?.[0]?.data;
  if (!post) return null;
  const parts = [post.title, post.selftext].filter(Boolean);
  const comments = (listing[1]?.data?.children || [])
    .map((c) => c.data)
    .filter((c) => c && c.body && !c.stickied && c.body !== '[deleted]' && c.body !== '[removed]')
    .slice(0, 5);
  if (comments.length) {
    parts.push('Top comments:');
    for (const c of comments) parts.push(`${c.author}: ${c.body}`);
  }
  const text = parts.join('\n\n').trim();
  return text ? { text, title: post.title || null } : null;
}

// --- LinkedIn ------------------------------------------------------------

async function linkedInPost(url, fetchImpl) {
  let sawWall = false;
  for (const candidate of linkedInCandidates(url)) {
    let response;
    try {
      response = await get(candidate, fetchImpl);
    } catch {
      continue;
    }
    const html = await response.text();
    const finalURL = new URL(response.url || candidate);
    if (isLoginWall(html, finalURL)) {
      sawWall = true;
      continue;
    }
    const post = parseLinkedIn(html);
    if (post) return post;
  }
  throw new LinkError(sawWall ? "Couldn't access this LinkedIn post automatically. It may be private."
                              : "Couldn't access this LinkedIn post automatically.");
}

function linkedInActivityID(url) {
  const text = decodeURIComponent(url.href);
  const match = text.match(/urn:li:(?:activity|share|ugcPost):(\d{10,})/) || text.match(/-activity-(\d{10,})/);
  return match ? match[1] : null;
}

function linkedInCandidates(url) {
  const urls = [url.href];
  const id = linkedInActivityID(url);
  if (id) urls.push(`https://www.linkedin.com/embed/feed/update/urn:li:activity:${id}`);
  return urls;
}

function isLoginWall(html, url) {
  const path = url.pathname.toLowerCase();
  if (path.includes('authwall') || path.startsWith('/login') || path.includes('/checkpoint')) return true;
  const head = html.slice(0, 4000).toLowerCase();
  return head.includes('<title>sign up | linkedin</title>') || head.includes('<title>linkedin login')
    || head.includes('<title>sign in');
}

function parseLinkedIn(html) {
  // 1. Structured data: the full post text, as LinkedIn publishes it for public posts.
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, json] of scripts) {
    try {
      const post = findPost(JSON.parse(json));
      if (post) return post;
    } catch { /* not JSON */ }
  }
  // 2. The embed page's post text.
  const segments = [...html.matchAll(/<[^>]+class=["'][^"']*attributed-text-segment-list__content[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|div|span)>/gi)]
    .map(([, inner]) => decodeEntities(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (segments[0] && segments[0].length >= 40) return { text: segments[0], title: null };
  return null;
}

function findPost(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const post = findPost(item);
      if (post) return post;
    }
  } else if (value && typeof value === 'object') {
    const body = value.articleBody || value.text;
    if (typeof body === 'string' && body.trim().length >= 40) {
      const author = Array.isArray(value.author) ? value.author[0]?.name : value.author?.name;
      return { text: decodeEntities(body).trim(), title: author ? `Post by ${author}` : null };
    }
    for (const item of Object.values(value)) {
      const post = findPost(item);
      if (post) return post;
    }
  }
  return null;
}

// --- Articles ------------------------------------------------------------

async function article(url, fetchImpl, render) {
  let html = null;
  let finalURL = url.href;
  try {
    const response = await get(url.href, fetchImpl);
    if (response.ok) {
      html = await response.text();
      finalURL = response.url || url.href;
    }
  } catch { /* try rendering below */ }

  let page = html ? readArticle(html, finalURL) : null;
  // Pages that build their text with JavaScript come back nearly empty: load
  // them in a hidden browser window, as Chrome would.
  if ((!page || page.text.length < 300) && render) {
    try {
      const rendered = readArticle(await render(url.href), url.href);
      if (rendered && (!page || rendered.text.length > page.text.length)) page = rendered;
    } catch { /* keep what we have */ }
  }
  if (!page || page.text.length < 40) throw new LinkError("Couldn't access this page automatically.");
  return page;
}

function readArticle(html, url) {
  const { document } = parseHTML(html);
  let title = null;
  let text = '';
  try {
    const parsed = new Readability(document, { charThreshold: 200 }).parse();
    if (parsed) {
      title = parsed.title || null;
      text = (parsed.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }
  } catch { /* fall through */ }
  if (!text) {
    const body = parseHTML(html).document.body;
    text = body ? (body.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }
  void url;
  return text ? { text, title } : null;
}

function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return named[code.toLowerCase()] ?? m;
  });
}

module.exports = {
  resolve, LinkError, sourceName, isPostSource,
  // For tests:
  parseXOEmbed, parseReddit, parseLinkedIn, isLoginWall, linkedInActivityID, interstitialTarget, readArticle,
};
