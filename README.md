# Project 7: NASA API - Space Explorer App
NASA releases a new "Astronomy Picture of the Day" (APOD) every day—spotlighting breathtaking images of galaxies, stars, planets, and more.

Your task is to build an interactive web app that fetches and displays these photos using [NASA's API](https://api.nasa.gov/). Users will pick a date range and instantly view stunning photos from across the cosmos, along with titles and descriptions.

You'll get to use your skills to build something that's actually connected to real-world data from one of the most iconic organizations in the world.

## Starter Files
- The provided files include a NASA logo, date inputs, a button, a placeholder for your gallery, and basic layout and styling to help you get started.
- It also includes built-in logic (in `dateRange.js`) to handle the valid APOD date range—from June 16, 1995 to today. No need to modify it.
- Custom browser JavaScript stays in `script.js`. The added `server.js` handles private API requests; a server is necessary to keep the key out of browser code.

## Run the App
Use Node.js 22 or newer. No dependency installation or build is needed. An internet connection is required to reach NASA and load its media.

1. Configure `NASA_API_KEY` in the server environment as described below.
2. Run `node server.js` from the project folder.
3. Open `http://localhost:3000`. In Codespaces, forward port 3000 and keep its visibility **Private**.

Set `PORT` to another port if 3000 is already in use. Opening the HTML directly, using Live Server, or using the old Python static server will not provide the `/api/apod` endpoint.

## Store the API Key Safely
The starter had no backend or secrets integration. The new server reads `process.env.NASA_API_KEY`; it never defaults to a hard-coded key. Obtain a key from https://api.nasa.gov/ and enter it only into private settings, not source code or chat.

- **GitHub Codespaces:** Open the repository's **Settings > Secrets and variables > Codespaces**, or your personal **Settings > Codespaces > Secrets**. Add a secret named `NASA_API_KEY`, grant this repository access if needed, and restart the codespace so it becomes available to `node server.js`. GitHub Actions secrets do not automatically become Codespaces environment variables.
- **Local development:** Create a `.env` file in this folder using your editor. Add one line with the variable name `NASA_API_KEY`, an equals sign, and your key. Run `node --env-file=.env server.js`. Plain `node server.js` does not automatically load that file. `.gitignore` excludes `.env` and `.env.*`; the server also refuses to serve them. Never force-add them to Git.
- **Hosting:** Configure `NASA_API_KEY` in the host's private runtime environment settings and restart the server. Static hosting such as GitHub Pages cannot run this server; use a Node-capable host. If exposing the proxy publicly, add authentication and rate limiting first so others cannot consume your API quota.

Do not put the key in HTML, browser JavaScript, frontend build variables, committed configuration, logs, screenshots, or chat. Restart the server after changing the environment value. Never share the key to troubleshoot a failed request.

## Dates and API Access
- Choose a start date and the supplied date helper fills in an end date eight days later. Both endpoints are included, giving nine consecutive daily entries.
- The dates must be between June 16, 1995 and today. If the helper clamps the end to today and fewer than nine days remain, choose an earlier start. Manually changing the end date must still leave exactly nine days.
- Click **Get Space Images** to load the range. The app requires one entry for each selected day; an unpublished day or incomplete response produces an error instead of silently showing fewer entries.
- The browser requests `/api/apod` with only the selected dates. The server calls `https://api.nasa.gov/planetary/apod` with `NASA_API_KEY`. Missing configuration, rejected keys, rate limits, timeouts, invalid data, and NASA service errors produce clear messages without revealing the key.
- APOD includes videos as well as images. Video cards open details with a link to watch the video in another tab. Missing or broken images retain their title, date, and details.
- NASA can return HTTP 200 with nine dates but the same NASA website logo and generic title for every entry. This is unusable upstream data, not nine astronomy images. The app rejects that known logo, uses an entry's own standard URL if it is valid, and otherwise reports the API problem. It does not substitute random or unrelated images.
- An API key change cannot guarantee a fix for bad upstream APOD data. Each real image uses its own `hdurl`, then its own `url` if needed, then an unavailable-image message only when neither can load. API failures do not generate substitute image cards.

## Automated Checks
Run `node --test server.test.js`. Tests use a deliberately fake key and mocked NASA responses, never your private key. They check the proxy's date range, secret isolation, blocked private files, NASA errors, logo-only data, and browser request/rendering behavior. They do not prove the live NASA service is currently healthy.

## Manual Checks
- Load a past nine-day range and confirm nine dated cards. Load a second range and confirm the gallery updates.
- Try empty dates, reversed dates, a shorter or longer range, and a start too close to today. Confirm clear errors appear.
- Open an image card and a video card. Use Tab, Shift+Tab, Enter, and Escape; focus should stay in the open dialog and return to its card when closed.
- Check mobile and desktop widths, long titles, image hover zoom, and the randomly selected fact on page reload.
- Check a failed network request, rate-limited response, incomplete data, and a broken image URL. Loading must end and the controls must become usable again.
- In browser developer tools, open Network and inspect `/api/apod`. Confirm `start_date` and `end_date` match your selection, the request contains no `api_key`, and a successful response has nine consecutive dates. Match each card's displayed date to that response object's `hdurl` (or its own `url` if the HD image is unavailable). Video entries must not create an image. If both URLs point to the NASA website logo, expect the API-data error instead of repeated logo cards.
- Start without `NASA_API_KEY` and confirm the configuration message. Test a valid key privately in your own server environment; never share it in a test report. Check that requests to `/.env`, `/server.js`, and `/.git/config` return 404.

The starter README has no reflection questions. For a course reflection, describe only steps you personally performed, an issue you actually encountered, and what your own tests showed. Do not describe mocked API checks as a successful live NASA request.
