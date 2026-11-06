const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { createAppServer } = require('./server');

const fakeKey = 'test-only-not-a-real-nasa-key';
const dates = '?start_date=2025-01-01&end_date=2025-01-09';
const logo = 'https://science.nasa.gov/wp-content/themes/nasa-child/assets/images/nasa-logo@2x.png';

function makeEntries() {
  return Array.from({ length: 9 }, (_, index) => ({
    date: `2025-01-0${index + 1}`,
    title: `Entry ${index + 1}`,
    explanation: `Details ${index + 1}`,
    media_type: index === 8 ? 'video' : 'image',
    hdurl: index === 8 ? '' : `https://example.com/${index + 1}-hd.jpg`,
    url: index === 8 ? 'https://example.com/video' : `https://example.com/${index + 1}.jpg`
  }));
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

test('proxy keeps the key server-side and exposes only public files', async (context) => {
  let nasaUrl;
  const entries = makeEntries().reverse();
  entries[0].explanation = `Do not expose ${fakeKey}`;
  entries[0].internalKey = fakeKey;
  const base = await startTestServer(context, {
    apiKey: fakeKey,
    fetchApod: async (url) => {
      nasaUrl = url;
      return { ok: true, json: async () => entries };
    }
  });
  const response = await fetch(`${base}/api/apod${dates}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.text();
  assert.ok(!body.includes(fakeKey));
  const publicEntries = JSON.parse(body);
  assert.equal(publicEntries.length, 9);
  assert.equal(publicEntries[0].date, '2025-01-01');
  assert.equal(publicEntries[0].hdurl, 'https://example.com/1-hd.jpg');
  assert.equal(nasaUrl.origin + nasaUrl.pathname, 'https://api.nasa.gov/planetary/apod');
  assert.equal(nasaUrl.searchParams.get('api_key'), fakeKey);
  assert.equal(nasaUrl.searchParams.get('start_date'), '2025-01-01');
  assert.equal(nasaUrl.searchParams.get('end_date'), '2025-01-09');
  for (const privatePath of ['/.env', '/.env.local', '/server.js', '/server.test.js', '/.git/config']) {
    assert.equal((await fetch(`${base}${privatePath}`)).status, 404);
  }
  const browserSource = await (await fetch(`${base}/js/script.js`)).text();
  assert.ok(!browserSource.includes('DEMO_KEY'));
  assert.ok(!browserSource.includes('api_key:'));
});

test('invalid dates, methods, and absent configuration never call NASA', async (context) => {
  let called = false;
  const base = await startTestServer(context, {
    apiKey: '', fetchApod: async () => { called = true; }
  });
  for (const query of ['', '?start_date=2025-01-01&end_date=2025-01-08',
    '?start_date=2025-02-30&end_date=2025-03-10',
    `${dates}&api_key=browser-key`, `${dates}&start_date=2025-01-01`]) {
    assert.equal((await fetch(`${base}/api/apod${query}`)).status, 400);
  }
  assert.equal((await fetch(`${base}/api/apod${dates}`, { method: 'POST' })).status, 405);
  const response = await fetch(`${base}/api/apod${dates}`);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /NASA_API_KEY/);
  assert.equal(called, false);
});

test('upstream errors are clear and never echo a secret', async (context) => {
  let upstreamStatus = 401;
  let failure;
  const base = await startTestServer(context, {
    apiKey: fakeKey,
    fetchApod: async () => {
      if (failure) throw failure;
      return { ok: false, status: upstreamStatus };
    }
  });
  for (const [status, expectedStatus, message] of [
    [401, 502, /rejected/], [403, 502, /rejected/],
    [429, 429, /rate limit/], [500, 502, /HTTP 500/]
  ]) {
    upstreamStatus = status;
    const response = await fetch(`${base}/api/apod${dates}`);
    assert.equal(response.status, expectedStatus);
    assert.match((await response.json()).error, message);
  }
  failure = new Error(`Upstream URL includes ${fakeKey}`);
  let response = await fetch(`${base}/api/apod${dates}`);
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes(fakeKey));
  failure.name = 'TimeoutError';
  response = await fetch(`${base}/api/apod${dates}`);
  assert.equal(response.status, 504);
});

test('logo-only and incomplete data are errors, not replacement images', async (context) => {
  let entries = makeEntries().map((entry) => ({ ...entry, media_type: 'image', hdurl: logo, url: logo }));
  const base = await startTestServer(context, {
    apiKey: fakeKey, fetchApod: async () => ({ ok: true, json: async () => entries })
  });
  let response = await fetch(`${base}/api/apod${dates}`);
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /website logo/);
  entries = makeEntries();
  entries[0].hdurl = logo;
  response = await fetch(`${base}/api/apod${dates}`);
  assert.equal(response.status, 200);
  entries = makeEntries().slice(1);
  assert.equal((await fetch(`${base}/api/apod${dates}`)).status, 502);
  entries = makeEntries();
  entries[1].date = entries[0].date;
  assert.equal((await fetch(`${base}/api/apod${dates}`)).status, 502);
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
  let responseData = makeEntries();
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
  elements.startDate.value = '2025-01-01';
  elements.endDate.value = '2025-01-09';
  await vm.runInContext('getSpaceImages()', context);
  assert.equal(requestedUrl, `/api/apod${dates}`);
  assert.equal(elements.gallery.children.length, 9);
  elements.gallery.children.forEach((card, index) => {
    assert.equal(card.children[2].dateTime, responseData[index].date);
    const media = card.children[0].firstChild;
    if (index === 8) {
      assert.notEqual(media.tag, 'img');
      card.listeners.click();
      assert.equal(elements.modalMedia.children[1].href, responseData[index].url);
    } else {
      assert.equal(media.src, responseData[index].hdurl);
      media.listeners.error();
      assert.equal(media.src, responseData[index].url);
      media.listeners.error();
      assert.equal(media.replacement.textContent, 'Image unavailable');
    }
  });
  ok = false;
  responseData = { error: 'The server needs NASA_API_KEY configured.' };
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
  responseData = makeEntries();
  await vm.runInContext('getSpaceImages()', context);
  assert.equal(elements.gallery.children.length, 9);
});