'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, WhatsApp } = require('../src/core/input');
const { clean, split } = require('../src/core/speech-text');
const links = require('../src/core/links');
const { createPipeline, NothingToRead } = require('../src/core/pipeline');

const POST = 'We shipped our AI assistant today after 14 months. Three lessons. First, talk to users every week. '
  + 'Second, cut scope early: we dropped 40% of the roadmap in March and launched two months sooner. '
  + 'Third, measure retention, not signups: day-30 retention is 38%.';

// --- Input ---------------------------------------------------------------------

test('a copied link is a link; text is text; tiny copies are rejected', () => {
  assert.equal(classify('  https://www.linkedin.com/posts/jane_ai-activity-7123456789012345678-abcd \n').kind, 'url');
  assert.equal(classify('www.example.com/blog/post').url.href, 'https://www.example.com/blog/post');
  assert.equal(classify(POST).kind, 'text');
  assert.equal(classify('ok thanks').kind, 'short');
  assert.equal(classify('   ').kind, 'empty');
  // A message that contains a link is still a message.
  assert.equal(classify(`${POST} More at https://example.com`).kind, 'text');
});

test('WhatsApp Desktop copies drop the brackets and keep names', () => {
  const copied = '[10:15 pm, 29/09/2026] Ritu: The meeting moved to 6 because the client is late.\n[10:16 pm, 29/09/2026] Sam Kumar: Okay, bringing the contract.';
  assert.ok(WhatsApp.isChat(copied));
  const input = classify(copied);
  assert.equal(input.source, 'WhatsApp');
  assert.equal(input.text, 'Ritu: The meeting moved to 6 because the client is late.\nSam Kumar: Okay, bringing the contract.');
});

// --- Speech text -----------------------------------------------------------------

test('markdown is made speakable', () => {
  const spoken = clean('## Plan\n\n- Ship on **Friday**\n- Read [the doc](https://x.com/d)\n\n```js\nconst a = 1;\n```\nSee https://example.com/x');
  assert.match(spoken, /^Plan\./);
  assert.match(spoken, /Ship on Friday\./);
  assert.match(spoken, /Read the doc\./);
  assert.match(spoken, /code block/);
  assert.doesNotMatch(spoken, /[*#`]|https?:/);
});

test('pieces start short so the voice starts fast, and cover all the text', () => {
  const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i + 1} explains one more detail about the plan.`).join(' ');
  const pieces = split(text);
  assert.ok(pieces.length >= 3);
  assert.ok(pieces[0].length <= 220, `first piece is ${pieces[0].length} characters`);
  assert.ok(pieces.every((p) => p.length <= 2000));
  assert.equal(pieces.join(' ').replace(/\s+/g, ' '), text);
});

// --- Links -----------------------------------------------------------------------

test('LinkedIn public post text from structured data, and the embed page', () => {
  const ld = `<html><head><title>Jane on LinkedIn</title><script type="application/ld+json">${JSON.stringify({
    '@type': 'SocialMediaPosting', author: { name: 'Jane Doe' }, articleBody: POST,
  })}</script></head></html>`;
  assert.deepEqual(links.parseLinkedIn(ld), { text: POST, title: 'Post by Jane Doe' });

  const embed = '<p class="attributed-text-segment-list__content text-color-text">Hiring two iOS engineers in Bengaluru.<br>Strong Swift required, apply by Friday.</p>';
  assert.equal(links.parseLinkedIn(embed).text, 'Hiring two iOS engineers in Bengaluru.\nStrong Swift required, apply by Friday.');
});

test('LinkedIn sign-in walls and activity IDs are recognised', () => {
  assert.ok(links.isLoginWall('', new URL('https://www.linkedin.com/authwall?trk=x')));
  assert.ok(links.isLoginWall('<title>Sign Up | LinkedIn</title>', new URL('https://www.linkedin.com/feed/')));
  assert.equal(links.linkedInActivityID(new URL('https://www.linkedin.com/posts/jane_ai-activity-7123456789012345678-abcd')), '7123456789012345678');
  assert.equal(links.linkedInActivityID(new URL('https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/')), '7123456789012345678');
});

test('X posts come from oEmbed', () => {
  const post = links.parseXOEmbed({
    author_name: 'Jane Doe',
    html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">We cut our AWS bill by 42% &amp; kept latency flat.<br>Thread below</p>&mdash; Jane</blockquote>',
  });
  assert.deepEqual(post, { text: 'We cut our AWS bill by 42% & kept latency flat.\nThread below', title: 'Post by Jane Doe' });
});

test('Reddit posts include the top comments', () => {
  const json = [
    { data: { children: [{ data: { title: 'Should I learn Swift or Kotlin?', selftext: 'I have 3 months.' } }] } },
    { data: { children: [
      { data: { author: 'a', body: 'Swift if you have a Mac.' } },
      { data: { author: 'mod', body: 'Rules', stickied: true } },
      { data: { author: 'b', body: '[deleted]' } },
    ] } },
  ];
  const post = links.parseReddit(json);
  assert.match(post.text, /Should I learn Swift or Kotlin\?\n\nI have 3 months\.\n\nTop comments:\n\na: Swift if you have a Mac\./);
  assert.doesNotMatch(post.text, /Rules|deleted/);
});

test('articles are extracted without menus and footers', () => {
  const body = Array.from({ length: 8 }, (_, i) => `<p>Paragraph ${i + 1} of the article explains an important finding in detail, with numbers like ${i * 7}%.</p>`).join('');
  const html = `<html><head><title>Big finding</title></head><body><nav>Home About Pricing Login</nav><article><h1>Big finding</h1>${body}</article><footer>© 2026 Cookies Privacy</footer></body></html>`;
  const page = links.readArticle(html, 'https://example.com/a');
  assert.match(page.text, /Paragraph 1 of the article/);
  assert.match(page.text, /Paragraph 8/);
  assert.doesNotMatch(page.text, /Pricing|Cookies/);
});

test('lnkd.in interstitial pages point to the real link', () => {
  const html = '<a class="artdeco-button" data-tracking-control-name="external_url_click" href="https://www.linkedin.com/posts/jane_ai-activity-7123456789012345678-abcd">Continue</a>';
  assert.equal(links.interstitialTarget(html), 'https://www.linkedin.com/posts/jane_ai-activity-7123456789012345678-abcd');
});

test('a private LinkedIn post fails with a plain message', async () => {
  const fakeFetch = async (url) => ({
    ok: true, url: 'https://www.linkedin.com/authwall?trk=x', text: async () => '<title>Sign Up | LinkedIn</title>',
  });
  await assert.rejects(
    links.resolve(new URL('https://www.linkedin.com/posts/jane_ai-activity-7123456789012345678-abcd'), { fetch: fakeFetch }),
    (error) => error instanceof links.LinkError && /Couldn't access this LinkedIn post automatically/.test(error.message),
  );
});

// --- Pipeline: the action survives every step ---------------------------------

function fakePipeline(calls) {
  return createPipeline({
    resolve: async (url) => { calls.push(['resolve', url.href]); return { text: POST, title: 'Post by Jane Doe', source: 'LinkedIn', url: url.href }; },
    summarize: async (text) => { calls.push(['summarize', text]); return 'Launched after 14 months. Weekly user calls, 40% less scope, 38% day-30 retention.'; },
  });
}

test('TL;DR of a copied link: fetch, then summarize, then speak the summary', async () => {
  const calls = [];
  const stages = [];
  const result = await fakePipeline(calls).prepare('https://www.linkedin.com/posts/jane_ai-activity-7123456789012345678-abcd', 'tldr', (s) => stages.push(s));
  assert.deepEqual(stages, ['fetching', 'summarizing']);
  assert.equal(calls[1][1], POST, 'the fetched post is what gets summarized');
  assert.equal(result.action, 'tldr');
  assert.match(result.spoken, /^Launched after 14 months/);
  assert.equal(result.original, POST);
  assert.equal(result.source, 'LinkedIn');
});

test('Read of a copied link speaks the original and never summarizes', async () => {
  const calls = [];
  const result = await fakePipeline(calls).prepare('https://www.linkedin.com/posts/jane_ai-activity-7123456789012345678-abcd', 'read');
  assert.equal(calls.filter(([c]) => c === 'summarize').length, 0);
  assert.equal(result.spoken, POST);
});

test('copied text is summarized directly, without fetching', async () => {
  const calls = [];
  const stages = [];
  const result = await fakePipeline(calls).prepare(POST, 'tldr', (s) => stages.push(s));
  assert.deepEqual(stages, ['summarizing']);
  assert.equal(calls.filter(([c]) => c === 'resolve').length, 0);
  assert.equal(result.source, 'Copied text');
});

test('pressing again on the same content reuses the result; new content is new', async () => {
  const calls = [];
  const pipeline = fakePipeline(calls);
  await pipeline.prepare(POST, 'tldr');
  const again = await pipeline.prepare(POST, 'tldr');
  assert.equal(again.fromCache, true);
  assert.equal(calls.length, 1);
  const other = await pipeline.prepare(`${POST} One more update: the launch party is on Friday.`, 'tldr');
  assert.equal(other.fromCache, false);
  assert.equal(calls.length, 2);
});

test('nothing copied gives a plain message', async () => {
  await assert.rejects(fakePipeline([]).prepare('', 'tldr'), NothingToRead);
  await assert.rejects(fakePipeline([]).prepare('ok', 'tldr'), /too short/);
});


test('a TL;DR keeps the key points the server sends, for History', async () => {
  const pipeline = createPipeline({
    resolve: async () => { throw new Error('no fetch'); },
    summarize: async () => ({ summary: 'Launched after 14 months, with 40% less scope.', highlights: ['Launched after 14 months', '40% less scope', ''] }),
  });
  const result = await pipeline.prepare('We launched after 14 months of work, and we cut 40% of the scope to get there. Here is what we learned along the way.', 'tldr');
  assert.equal(result.spoken, 'Launched after 14 months, with 40% less scope.');
  assert.deepEqual(result.highlights, ['Launched after 14 months', '40% less scope']);
  const read = await pipeline.prepare('We launched after 14 months of work, and we cut 40% of the scope to get there. Here is what we learned along the way.', 'read');
  assert.deepEqual(read.highlights, []);
});


// --- Which app the text came from (its logo shows in the pill) -----------------
{
  const { appFromURL, appFromSource, clipboardSourceURL } = require('../src/core/source-app');

  test('source app: logos for ChatGPT, Claude, X, LinkedIn and Grok pages; none for others', async () => {
    assert.equal(appFromURL('https://chatgpt.com/c/123'), 'chatgpt');
    assert.equal(appFromURL('https://claude.ai/chat/1'), 'claude');
    assert.equal(appFromURL('https://x.com/a/status/1'), 'x');
    assert.equal(appFromURL('https://www.linkedin.com/feed/'), 'linkedin');
    assert.equal(appFromURL('https://grok.com/'), 'grok');
    assert.equal(appFromURL('https://example.com/'), null);
    assert.equal(appFromSource('LinkedIn'), 'linkedin');
    assert.equal(appFromSource('Copied text'), null);
    const windowsClipboard = { read: async (f) => (f === 'HTML Format' ? 'Version:0.9\r\nSourceURL:https://chatgpt.com/c/9\r\n<html>' : '') };
    assert.equal(await clipboardSourceURL(windowsClipboard), 'https://chatgpt.com/c/9');
    const macClipboard = { read: async (f) => (f === 'org.chromium.source-url' ? 'https://claude.ai/chat/2' : '') };
    assert.equal(await clipboardSourceURL(macClipboard), 'https://claude.ai/chat/2');
    assert.equal(await clipboardSourceURL({ read: async () => { throw new Error('no'); } }), null);
  });
}

// --- A website's own logo, for pages without one in the app ----------------------
{
  const { siteIcon } = require('../src/front-app');
  const png = Buffer.alloc(200, 1);
  const respond = (ok, type, body) => ({ ok, headers: { get: () => type }, arrayBuffer: async () => body });

  test('site icon: the touch icon, else the favicon, else nothing', async () => {
    const asked = [];
    const touch = async (url) => { asked.push(url); return respond(true, 'image/png', png); };
    assert.match(await siteIcon('https://medium.com/@a/post', touch), /^data:image\/png;base64,/);
    assert.deepEqual(asked, ['https://medium.com/apple-touch-icon.png']);
    const onlyFavicon = async (url) => (url.endsWith('.ico') ? respond(true, 'image/x-icon', png) : respond(false, 'text/html', Buffer.alloc(0)));
    assert.match(await siteIcon('https://example.org/x', onlyFavicon), /^data:image\/x-icon;base64,/);
    assert.equal(await siteIcon('https://example.org/x', async () => { throw new Error('offline'); }), null);
    assert.equal(await siteIcon('not a url', touch), null);
  });
}
