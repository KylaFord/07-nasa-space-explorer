const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { createAppServer } = require('./server');

const dates = '?start_date=2024-01-01&end_date=2024-12-31';

function makeEntries() {
  return Array.from({ length: 9 }, (_, index) => ({
    id: `image-${index}`,
    date: '2024-03-01',
    title: `Entry ${index + 1}`,
    explanation: `Details ${index + 1}`,
    media_type: 'image',
    url: `https://images-assets.nasa.gov/image/test/${index + 1}.jpg`
  }));
}

function nasaResponse(entries, links = []) {
  return { ok: true, json: async () => ({ collection: {
    items: entries.map((entry) => ({
      data: [{ nasa_id: entry.id, date_created: `${entry.date}T00:00:00Z`,
        title: entry.title, description: entry.explanation, media_type: entry.media_type }],
      links: [{ render: 'image', href: entry.url }]
    })), links
  } }) };
}

async function startTestServer(context, options) {
  const server = createAppServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('library search returns nine distinct images without any API key', async (context) => {
  let nasaUrl;
  const entries = makeEntries().reverse();
  const base = await startTestServer(context, {
    fetchImages: async (url) => {
      nasaUrl = url;
      return nasaResponse(entries);
    }
  });
  const response = await fetch(`${base}/api/images${dates}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  const publicEntries = body.entries;
  assert.equal(publicEntries.length, 9);
  assert.equal(publicEntries[0].date, '2024-03-01');
  assert.equal(publicEntries[0].url, entries[0].url);
  assert.equal(publicEntries[0].title, entries[0].title);
  assert.equal(nasaUrl.origin + nasaUrl.pathname, 'https://images-api.nasa.gov/search');
  assert.equal(nasaUrl.searchParams.has('api_key'), false);
  assert.equal(nasaUrl.searchParams.get('year_start'), '2024');
  assert.equal(nasaUrl.searchParams.get('year_end'), '2024');
  assert.equal(nasaUrl.searchParams.get('media_type'), 'image');
  assert.equal(body.searchLimited, false);
  for (const privatePath of ['/.env', '/.env.local', '/server.js', '/server.test.js', '/.git/config', '/api/apod']) {
    assert.equal((await fetch(`${base}${privatePath}`)).status, 404);
  }
  const browserSource = await (await fetch(`${base}/js/script.js`)).text();
  assert.ok(!browserSource.includes('DEMO_KEY'));
  assert.ok(!browserSource.includes('api_key:'));
});

test('invalid dates, methods and unsupported parameters never call NASA', async (context) => {
  let called = false;
  const base = await startTestServer(context, {
    fetchImages: async () => { called = true; return nasaResponse([]); }
  });
  for (const query of ['', '?start_date=2024-12-31&end_date=2024-01-01',
    '?start_date=2024-02-30&end_date=2024-03-10',
    '?start_date=1919-01-01&end_date=2024-01-01',
    `${dates}&api_key=browser-key`, `${dates}&start_date=2024-01-01`]) {
    assert.equal((await fetch(`${base}/api/images${query}`)).status, 400);
  }
  assert.equal((await fetch(`${base}/api/images${dates}`, { method: 'POST' })).status, 405);
  assert.equal(called, false);
});

test('upstream errors are clear and never echo private error details', async (context) => {
  let upstreamStatus = 500;
  let failure;
  const base = await startTestServer(context, {
    fetchImages: async () => {
      if (failure) throw failure;
      return { ok: false, status: upstreamStatus };
    }
  });
  for (const [status, expectedStatus, message] of [
    [429, 429, /rate limit/], [500, 502, /HTTP 500/]
  ]) {
    upstreamStatus = status;
    const response = await fetch(`${base}/api/images${dates}`);
    assert.equal(response.status, expectedStatus);
    assert.match((await response.json()).error, message);
  }
  failure = new Error('Private upstream details');
  let response = await fetch(`${base}/api/images${dates}`);
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('Private upstream details'));
  failure.name = 'TimeoutError';
  response = await fetch(`${base}/api/images${dates}`);
  assert.equal(response.status, 504);
});

test('pagination filters exact dates, duplicate IDs, videos and unsafe images', async (context) => {
  const entries = makeEntries();
  let calls = 0;
  const base = await startTestServer(context, {
    fetchImages: async () => {
      calls += 1;
      return calls === 1 ? nasaResponse([
        { ...entries[0], date: '2024-02-01' },
        { ...entries[1], url: 'https://science.nasa.gov/wp-content/themes/nasa-child/assets/images/nasa-logo@2x.png' },
        { ...entries[2], media_type: 'video' },
        { ...entries[3], url: 'javascript:alert(1)' },
        entries[0], entries[0]
      ], [{ rel: 'next' }]) : nasaResponse(entries);
    }
  });
  const response = await fetch(`${base}/api/images?start_date=2024-03-01&end_date=2024-03-01`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.entries.length, 9);
  assert.equal(new Set(body.entries.map((entry) => entry.id)).size, 9);
  assert.ok(body.entries.every((entry) => entry.date === '2024-03-01'));
  assert.equal(calls, 2);
});

test('empty, partial, capped and malformed library results are handled honestly', async (context) => {
  let result = nasaResponse([]);
  let calls = 0;
  const base = await startTestServer(context, {
    fetchImages: async () => { calls += 1; return result; }
  });
  const request = () => fetch(`${base}/api/images${dates}`);
  assert.equal((await (await request()).json()).entries.length, 0);
  result = nasaResponse(makeEntries().slice(0, 2));
  assert.equal((await (await request()).json()).entries.length, 2);
  calls = 0;
  result = nasaResponse(makeEntries().slice(0, 2), [{ rel: 'next' }]);
  assert.equal((await (await request()).json()).searchLimited, true);
  assert.equal(calls, 5);
  result = { ok: true, json: async () => ({ unexpected: true }) };
  assert.equal((await request()).status, 502);
});

test('browser sends dates only, renders each entry, and handles server errors', async () => {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.validity = { valid: true }; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    setAttribute(name, value) { this[name] = value; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    replaceWith(element) { this.replacement = element; }
    get firstChild() { return this.children[0]; }
    showModal() { this.open = true; }
  }
  const elements = {};
  let requestedUrl;
  let responseData = { entries: makeEntries() };
  let ok = true;
  let contentType = 'application/json';
  let invalidJson = false;
  let parseCount = 0;
  const context = vm.createContext({
    URL, URLSearchParams, AbortSignal,
    document: {
      getElementById: (id) => elements[id] ||= new Element(),
      createElement: (tag) => new Element(tag)
    },
    fetch: async (url) => {
      requestedUrl = url;
      return {
        ok, status: ok ? 200 : 503,
        headers: { get: () => contentType },
        json: async () => {
          parseCount += 1;
          if (invalidJson) throw new SyntaxError('Unexpected token <');
          return responseData;
        }
      };
    }
  });
  vm.runInContext(readFileSync('js/dateRange.js', 'utf8'), context);
  vm.runInContext(readFileSync('js/script.js', 'utf8'), context);
  elements.startDate.value = '2024-01-01';
  elements.endDate.value = '2024-12-31';
  await vm.runInContext('getSpaceImages()', context);
  assert.equal(requestedUrl, `/api/images${dates}`);
  assert.equal(elements.gallery.children.length, 9);
  elements.gallery.children.forEach((card, index) => {
    const entry = responseData.entries[index];
    assert.equal(card.children[1].textContent, entry.title);
    assert.equal(card.children[2].textContent, entry.date);
    assert.equal(card.children[2].dateTime, entry.date);
    const media = card.children[0].firstChild;
    assert.equal(media.tag, 'img');
    assert.equal(media.src, entry.url);
    card.listeners.click();
    assert.equal(elements.entryModal.open, true);
    assert.equal(elements.modalTitle.textContent, entry.title);
    media.listeners.error();
    assert.equal(media.replacement.textContent, 'Image unavailable');
  });
  responseData = { entries: makeEntries().slice(0, 2), searchLimited: true };
  await vm.runInContext('getSpaceImages()', context);
  assert.equal(elements.gallery.children.length, 2);
  assert.match(elements.status.textContent, /Showing 2.*500/);
  responseData = { entries: [] };
  await vm.runInContext('getSpaceImages()', context);
  assert.match(elements.status.textContent, /No matching images/);
  ok = false;
  responseData = { error: 'NASA library unavailable.' };
  await vm.runInContext('getSpaceImages()', context);
  assert.equal(elements.status.textContent, responseData.error);
  assert.equal(elements.gallery.children.length, 0);
  assert.equal(elements.getImages.disabled, false);

  // HTML must never be parsed as JSON, even if the preview returns HTTP 200.
  ok = true;
  contentType = 'text/html; charset=UTF-8';
  invalidJson = true;
  const previousParseCount = parseCount;
  await vm.runInContext('getSpaceImages()', context);
  assert.equal(parseCount, previousParseCount);
  assert.match(elements.status.textContent, /not Live Server or a static preview/);
  assert.equal(elements.getImages.disabled, false);
  assert.equal(elements.gallery['aria-busy'], 'false');

  contentType = 'application/json';
  await vm.runInContext('getSpaceImages()', context);
  assert.match(elements.status.textContent, /returned invalid JSON/);

  invalidJson = false;
  responseData = { entries: makeEntries() };
  await vm.runInContext('getSpaceImages()', context);
  assert.equal(elements.gallery.children.length, 9);
  responseData = { entries: [makeEntries()[0], makeEntries()[0]] };
  await vm.runInContext('getSpaceImages()', context);
  assert.match(elements.status.textContent, /invalid image library records/);
});