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

function isWebsiteLogo(value) {
  try {
    const imageUrl = new URL(value);
    return imageUrl.hostname === 'science.nasa.gov' &&
      imageUrl.pathname === '/wp-content/themes/nasa-child/assets/images/nasa-logo@2x.png';
  } catch {
    return false;
  }
}

// Return only media URLs; never relay a secret included in an upstream URL.
function safeMediaUrl(value, apiKey) {
  if (typeof value !== 'string' || value.includes(apiKey)) return '';
  try {
    const mediaUrl = new URL(value);
    if (!['https:', 'http:'].includes(mediaUrl.protocol)) return '';
    mediaUrl.searchParams.delete('api_key');
    return mediaUrl.href;
  } catch {
    return '';
  }
}

function createAppServer({ apiKey = process.env.NASA_API_KEY, fetchApod = fetch } = {}) {
  return http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, 'http://localhost');
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        sendJson(response, 405, { error: 'Only GET requests are supported.' });
        return;
      }

      if (requestUrl.pathname !== '/api/apod') {
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
      const dayCount = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000 + 1;
      if (!isValidDate(startDate) || !isValidDate(endDate) ||
          startDate < '1995-06-16' || endDate > today || dayCount !== 9 ||
          [...requestUrl.searchParams.keys()].some((name) => !['start_date', 'end_date'].includes(name)) ||
          requestUrl.searchParams.getAll('start_date').length !== 1 ||
          requestUrl.searchParams.getAll('end_date').length !== 1) {
        sendJson(response, 400, { error: 'Select exactly nine consecutive dates within NASA\'s archive, ending no later than today.' });
        return;
      }
      if (!apiKey || !apiKey.trim()) {
        sendJson(response, 503, { error: 'The server needs NASA_API_KEY configured. Add it to the server environment and restart the app.' });
        return;
      }

      // The key is added only here, never in browser JavaScript or local requests.
      const nasaUrl = new URL('https://api.nasa.gov/planetary/apod');
      nasaUrl.search = new URLSearchParams({
        api_key: apiKey,
        start_date: startDate,
        end_date: endDate
      }).toString();
      const upstream = await fetchApod(nasaUrl, { signal: AbortSignal.timeout(25000) });
      if (!upstream.ok) {
        const error = upstream.status === 429
          ? 'NASA\'s API rate limit was reached. Please try again later.'
          : [401, 403].includes(upstream.status)
            ? 'NASA rejected the server API key. Check NASA_API_KEY in the server settings.'
            : `NASA could not load this range (HTTP ${upstream.status}). Please try again later.`;
        sendJson(response, upstream.status === 429 ? 429 : 502, { error });
        return;
      }

      const entries = await upstream.json();
      if (!Array.isArray(entries) || entries.length !== 9 || entries.some((entry) =>
        !entry || !isValidDate(entry.date) || entry.date < startDate || entry.date > endDate
      ) || new Set(entries.map((entry) => entry.date)).size !== 9) {
        sendJson(response, 502, { error: 'NASA did not return all nine daily entries. Try an earlier range or try again later.' });
        return;
      }
      if (entries.some((entry) => entry.media_type === 'image' &&
        [entry.hdurl, entry.url].some(isWebsiteLogo) &&
        ![entry.hdurl, entry.url].some((value) => safeMediaUrl(value, apiKey) && !isWebsiteLogo(value)))) {
        sendJson(response, 502, { error: 'NASA returned its website logo instead of daily astronomy images. Please try again later; changing keys may not fix upstream data.' });
        return;
      }

      // Whitelist response fields and redact the key if upstream text echoes it.
      const publicEntries = entries.map((entry) => ({
        date: entry.date,
        title: typeof entry.title === 'string' ? entry.title.replaceAll(apiKey, '[redacted]') : '',
        explanation: typeof entry.explanation === 'string' ? entry.explanation.replaceAll(apiKey, '[redacted]') : '',
        media_type: entry.media_type === 'video' ? 'video' : entry.media_type === 'image' ? 'image' : 'other',
        hdurl: safeMediaUrl(entry.hdurl, apiKey),
        url: safeMediaUrl(entry.url, apiKey)
      }));
      publicEntries.sort((first, second) => first.date.localeCompare(second.date));
      sendJson(response, 200, publicEntries);
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