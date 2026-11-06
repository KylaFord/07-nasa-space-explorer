const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

// Only these public files may be downloaded. Secrets and server code stay private.
const publicFiles = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/js/script.js', ['js/script.js', 'text/javascript']],
  ['/js/dateRange.js', ['js/dateRange.js', 'text/javascript']],
  ['/img/nasa-worm-logo.png', ['img/nasa-worm-logo.png', 'image/png']],
  ['/img/NASA-Logo-Large.jpg', ['img/NASA-Logo-Large.jpg', 'image/jpeg']]
]);

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(data));
}

function isValidDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

// Library images must come from NASA's media host, without credentials.
function safeMediaUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const mediaUrl = new URL(value);
    if (mediaUrl.protocol !== 'https:' || mediaUrl.hostname !== 'images-assets.nasa.gov' ||
        mediaUrl.username || mediaUrl.password || mediaUrl.searchParams.has('api_key')) return '';
    return mediaUrl.href;
  } catch {
    return '';
  }
}

function createAppServer({ fetchImages = fetch } = {}) {
  return http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, 'http://localhost');
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        sendJson(response, 405, { error: 'Only GET requests are supported.' });
        return;
      }

      if (requestUrl.pathname !== '/api/images') {
        const publicFile = publicFiles.get(requestUrl.pathname);
        if (!publicFile) {
          sendJson(response, 404, { error: 'Not found.' });
          return;
        }
        const content = await readFile(path.join(__dirname, publicFile[0]));
        response.writeHead(200, {
          'Content-Type': publicFile[1],
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        });
        response.end(content);
        return;
      }

      // Validate again on the server: browser validation can be bypassed.
      const startDate = requestUrl.searchParams.get('start_date');
      const endDate = requestUrl.searchParams.get('end_date');
      const today = new Date().toISOString().slice(0, 10);
      if (!isValidDate(startDate) || !isValidDate(endDate) ||
          startDate < '1920-01-01' || endDate > today || endDate < startDate ||
          [...requestUrl.searchParams.keys()].some((name) => !['start_date', 'end_date'].includes(name)) ||
          requestUrl.searchParams.getAll('start_date').length !== 1 ||
          requestUrl.searchParams.getAll('end_date').length !== 1) {
        sendJson(response, 400, { error: 'Choose a start and end date between 1920 and today, with the end on or after the start.' });
        return;
      }

      const entries = [];
      const seenIds = new Set();
      const signal = AbortSignal.timeout(25000);
      let moreAvailable = false;
      // NASA filters by year. Check exact dates locally across up to five pages.
      for (let page = 1; page <= 5 && entries.length < 9; page += 1) {
        const nasaUrl = new URL('https://images-api.nasa.gov/search');
        nasaUrl.search = new URLSearchParams({
          q: 'space', media_type: 'image',
          year_start: startDate.slice(0, 4), year_end: endDate.slice(0, 4),
          page: String(page), page_size: '100'
        }).toString();
        const upstream = await fetchImages(nasaUrl, { signal });
        if (!upstream.ok) {
          sendJson(response, upstream.status === 429 ? 429 : 502, {
            error: upstream.status === 429
              ? 'NASA\'s image library rate limit was reached. Please try again later.'
              : `NASA's image library could not load images (HTTP ${upstream.status}). Please try again later.`
          });
          return;
        }
        const data = await upstream.json();
        const items = data?.collection?.items;
        if (!Array.isArray(items)) {
          sendJson(response, 502, { error: 'NASA returned invalid image library data. Please try again later.' });
          return;
        }
        for (const item of items) {
          const entry = item?.data?.[0];
          const date = typeof entry?.date_created === 'string' ? entry.date_created.slice(0, 10) : '';
          const imageUrl = Array.isArray(item?.links)
            ? item.links.filter((link) => link?.render === 'image')
              .map((link) => safeMediaUrl(link.href)).find(Boolean)
            : '';
          if (entry?.media_type !== 'image' || typeof entry.nasa_id !== 'string' ||
              !entry.nasa_id || seenIds.has(entry.nasa_id) || !isValidDate(date) ||
              date < startDate || date > endDate || !imageUrl) continue;
          seenIds.add(entry.nasa_id);
          entries.push({
            id: entry.nasa_id, date,
            title: typeof entry.title === 'string' ? entry.title : 'Untitled NASA image',
            explanation: typeof entry.description === 'string' ? entry.description : '',
            media_type: 'image', url: imageUrl
          });
          if (entries.length === 9) break;
        }
        moreAvailable = Array.isArray(data.collection.links) &&
          data.collection.links.some((link) => link?.rel === 'next');
        if (!moreAvailable || items.length === 0) break;
      }

      entries.sort((first, second) => first.date.localeCompare(second.date));
      sendJson(response, 200, {
        entries,
        searchLimited: moreAvailable && entries.length < 9
      });
    } catch (error) {
      // Do not log or forward raw fetch errors: they may contain the secret URL.
      sendJson(response, error.name === 'TimeoutError' ? 504 : 502, {
        error: error.name === 'TimeoutError'
          ? 'NASA took too long to respond. Please try again.'
          : 'Unable to load NASA data. Check the server connection and try again.'
      });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const server = createAppServer();
  server.on('error', () => {
    console.error('Unable to start the server. Check that PORT is available.');
    process.exitCode = 1;
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`NASA Space Explorer: http://localhost:${port}`);
  });
}

module.exports = { createAppServer };