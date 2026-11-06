# Project 7: NASA API - Space Explorer App
Explore real space images using the [NASA Image and Video Library API](https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf).

Choose a date range to dynamically display up to nine image records, each with its image, title, and date. Open a card to read its description. This app now uses the Image Library instead of APOD because APOD was returning NASA website branding instead of astronomy images.

You'll get to use your skills to build something that's actually connected to real-world data from one of the most iconic organizations in the world.

## Starter Files
- The provided files include a NASA logo, date inputs, a button, a placeholder for your gallery, and basic layout and styling to help you get started.
- `js/dateRange.js` sets date limits and defaults to the previous calendar year.
- `js/script.js` fetches records and creates the gallery. `server.js` serves the app and queries NASA's public Image Library. No API key is required.

## Run the App
Use Node.js 22 or newer. No dependency installation or build is needed. An internet connection is required to reach NASA and load its media.

1. Run `node server.js` from the project folder.
2. Open the URL printed in the terminal. In Codespaces, forward that port and keep its visibility **Private**.

The default port is 3000. Use `PORT=4317 node server.js` if it is occupied. Opening the HTML directly or using Live Server will not provide the `/api/images` endpoint. Keep the Node server running while using the app.

## API Keys and Hosting
The Image Library does not require `NASA_API_KEY`. The app no longer reads or sends that variable. Any existing private key can remain in your private settings; never put it in code, logs, screenshots, or chat. Existing secrets are not deleted by this change.

Use a Node-capable host, not GitHub Pages. The server serves only an allowlist of public files; environment files and server code remain inaccessible. Add authentication and rate limiting before exposing the proxy publicly.

## Dates and API Access
- Choose any start and end dates between 1920 and today. Both endpoints are included; the end must be on or after the start.
- Click **Get Space Images** to load up to nine distinct records matching the space search. Records may share a date and are not daily APOD entries.
- Dates come from NASA's `date_created` field, not a guarantee of the original photograph's capture date.
- The browser requests `/api/images` with `start_date` and `end_date`. The server calls `https://images-api.nasa.gov/search` with `q=space`, `media_type=image`, and the selected years, then filters the exact dates locally.
- Each search checks up to five pages of 100 records within one 25-second timeout and stops when nine matches are found or the results end. A message explains if the 500-record search cap was reached before finding nine matches.
- Empty or partial results display an honest count. Try a wider date range for more matches. The app does not invent replacement photos or silently search outside the selected dates.
- Image URLs come from each record's image links and must use NASA's HTTPS media host. Broken images retain their title, date, and details.

## Automated Checks
Run `node --test server.test.js`. Tests use mocked library responses and no API keys. They check date validation, blocked private files, NASA errors, exact date filtering, pagination, duplicate IDs, unsafe images, partial results, and browser rendering. Mocked tests alone do not prove the live NASA service is healthy.

## Device Compatibility
The layout targets current Chrome, Edge, Firefox, and Safari. Automated visual and interaction checks were run in Chromium; physical iOS/Android devices and other browser engines still need manual testing.

- Verified viewport widths: 320, 375, 390, 600, 768, 844, 1024, 1440, and 1920 pixels, including phone landscape.
- The gallery uses one column on phones, two on tablets, and three on larger screens. Date controls and navigation wrap instead of overflowing.
- Inputs, navigation links, and action buttons have touch targets at least 44 pixels high.
- Long titles wrap, image proportions remain stable, and the details dialog scrolls within the available screen height.
- Browser checks cover loaded NASA images, touch-emulated phone taps, keyboard Enter/Tab/Escape, focus restoration, and reduced-motion preferences.
- These checks do not guarantee compatibility with every older browser, embedded webview, or physical device.

## Manual Checks
- Load the default year and confirm nine cards when enough records are available. Load a second range and confirm the gallery updates.
- Try empty dates, reversed dates, a narrow range, and future dates. Confirm clear validation or empty-result messages.
- Open an image card. Use Tab, Shift+Tab, Enter, and Escape; focus should stay in the open dialog and return to its card when closed.
- Check mobile and desktop widths, long titles, image hover zoom, and the randomly selected fact on page reload.
- Check a failed network request, rate-limited response, incomplete data, and a broken image URL. Loading must end and the controls must become usable again.
- In browser developer tools, inspect `/api/images`. Confirm selected dates match the request and each returned record matches its card's title, date, and image URL. Neither the browser nor the upstream request should contain an API key.
- Start without `NASA_API_KEY` and confirm the app works. Check that requests to `/.env`, `/server.js`, and `/.git/config` return 404.

The starter README has no reflection questions. For a course reflection, describe only steps you personally performed, an issue you actually encountered, and what your own tests showed. Do not describe mocked API checks as a successful live NASA request.
