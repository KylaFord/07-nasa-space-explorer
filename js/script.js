// Find our date picker inputs on the page
const startInput = document.getElementById('startDate');
const endInput = document.getElementById('endDate');

// Call the setupDateInputs function from dateRange.js
// This sets up the date pickers to:
// - Default to a range of 9 days (from 9 days ago to today)
// - Restrict dates to NASA's image archive (starting from 1995)
setupDateInputs(startInput, endInput);

const getImagesButton = document.getElementById('getImages');
const gallery = document.getElementById('gallery');
const statusMessage = document.getElementById('status');
const modal = document.getElementById('entryModal');
const modalTitle = document.getElementById('modalTitle');
const modalDate = document.getElementById('modalDate');
const modalMedia = document.getElementById('modalMedia');
const modalExplanation = document.getElementById('modalExplanation');
let lastOpenedButton;

// Choose a new fact when the page loads.
const spaceFacts = [
	'Sunlight takes about eight minutes to reach Earth.',
	'A day on Venus is longer than a year on Venus.',
	'The Moon is moving away from Earth by about 3.8 centimeters each year.',
	'Jupiter is the largest planet in our solar system.',
	'The International Space Station orbits Earth about every 90 minutes.'
];
document.getElementById('spaceFact').textContent = spaceFacts[
	Math.floor(Math.random() * spaceFacts.length)
];

// UTC dates make the day count independent of daylight-saving changes.
function validateDateRange() {
	const startDate = startInput.value;
	const endDate = endInput.value;
	if (!startDate || !endDate || !startInput.validity.valid || !endInput.validity.valid) {
		return 'Choose valid start and end dates within NASA\'s archive.';
	}
	if (startDate < startInput.min || endDate > endInput.max || endDate < startDate) {
		return `Choose dates from ${startInput.min} to ${endInput.max}, with the end after the start.`;
	}
	const dayCount = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000 + 1;
	if (dayCount !== 9) {
		return 'Choose exactly nine consecutive days: the end must be eight days after the start. Choose an earlier start if the range reaches beyond today.';
	}
	return '';
}

// Only allow web URLs, never executable URLs from external data.
function getWebUrl(value) {
	if (typeof value !== 'string') return '';
	try {
		const parsedUrl = new URL(value);
		return ['https:', 'http:'].includes(parsedUrl.protocol) ? parsedUrl.href : '';
	} catch {
		return '';
	}
}

// NASA can return its website logo when the upstream APOD data is unavailable.
function getApodImageUrl(value) {
	const webUrl = getWebUrl(value);
	if (!webUrl) return '';
	const parsedUrl = new URL(webUrl);
	if (parsedUrl.hostname === 'science.nasa.gov' &&
			parsedUrl.pathname === '/wp-content/themes/nasa-child/assets/images/nasa-logo@2x.png') {
		return '';
	}
	return webUrl;
}

function createMedia(entry) {
	const fallbackUrl = getApodImageUrl(entry.url);
	if (entry.media_type === 'image') {
		const imageUrl = getApodImageUrl(entry.hdurl) || fallbackUrl;
		if (imageUrl) {
			const image = document.createElement('img');
			image.src = imageUrl;
			image.alt = entry.title || 'NASA astronomy image';
			image.loading = 'lazy';
			// Try the standard image if the high-resolution image fails.
			image.addEventListener('error', () => {
				if (fallbackUrl && image.src !== fallbackUrl) {
					image.src = fallbackUrl;
				} else {
					const unavailable = document.createElement('p');
					unavailable.className = 'media-placeholder';
					unavailable.textContent = 'Image unavailable';
					image.replaceWith(unavailable);
				}
			});
			return image;
		}
	}
	const placeholder = document.createElement('p');
	placeholder.className = 'media-placeholder';
	placeholder.textContent = entry.media_type === 'video' ? 'Video entry' : 'Image unavailable';
	return placeholder;
}

function openEntry(entry, button) {
	lastOpenedButton = button;
	modalTitle.textContent = entry.title || 'Untitled astronomy entry';
	modalDate.textContent = entry.date;
	modalDate.dateTime = entry.date;
	modalExplanation.textContent = entry.explanation || 'No explanation available for this entry.';
	modalMedia.replaceChildren(createMedia(entry));
	// A link supports video hosts that do not allow embedded playback.
	if (entry.media_type === 'video') {
		const videoUrl = getWebUrl(entry.url);
		if (videoUrl) {
			const videoLink = document.createElement('a');
			videoLink.href = videoUrl;
			videoLink.target = '_blank';
			videoLink.rel = 'noopener noreferrer';
			videoLink.textContent = 'Watch video (opens in a new tab)';
			modalMedia.append(videoLink);
		} else {
			modalMedia.firstChild.textContent = 'Video URL unavailable';
		}
	}
	modal.showModal();
}

function displayEntries(entries) {
	gallery.replaceChildren();
	entries.forEach((entry) => {
		const card = document.createElement('button');
		card.type = 'button';
		card.className = 'gallery-item';
		card.setAttribute('aria-haspopup', 'dialog');
		const media = document.createElement('div');
		media.className = 'gallery-media';
		media.append(createMedia(entry));
		const title = document.createElement('h2');
		title.textContent = entry.title || 'Untitled astronomy entry';
		const date = document.createElement('time');
		date.textContent = entry.date;
		date.dateTime = entry.date;
		card.append(media, title, date);
		card.addEventListener('click', () => openEntry(entry, card));
		gallery.append(card);
	});
}

async function getSpaceImages() {
	const validationError = validateDateRange();
	gallery.replaceChildren();
	if (validationError) {
		statusMessage.textContent = validationError;
		return;
	}

	// Disable the controls so a second request cannot overwrite newer results.
	getImagesButton.disabled = true;
	startInput.disabled = true;
	endInput.disabled = true;
	gallery.setAttribute('aria-busy', 'true');
	statusMessage.textContent = 'Loading space images...';
	// The server adds the private API key; the browser sends only dates.
	const dateParameters = new URLSearchParams({
		start_date: startInput.value,
		end_date: endInput.value
	});
	const requestUrl = `/api/apod?${dateParameters}`;

	try {
		const response = await fetch(requestUrl, { signal: AbortSignal.timeout(30000) });
		// Static preview servers return an HTML error page, not API data.
		const contentType = response.headers.get('content-type') || '';
		if (!contentType.toLowerCase().includes('application/json')) {
			throw new Error('The API endpoint did not return JSON. Start node server.js and open the URL printed in its terminal, not Live Server or a static preview.');
		}
		let entries;
		try {
			entries = await response.json();
		} catch {
			throw new Error('The app server returned invalid JSON. Check that you opened the Node server URL and try again.');
		}
		if (!response.ok) {
			throw new Error(typeof entries?.error === 'string'
				? entries.error
				: `The app server could not load this range (HTTP ${response.status}). Please try again later.`);
		}
		// Require one daily entry per selected date, including both endpoints.
		if (!Array.isArray(entries) || entries.length !== 9 || entries.some((entry) =>
			!entry || typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
			!Number.isFinite(Date.parse(`${entry.date}T00:00:00Z`)) ||
			new Date(`${entry.date}T00:00:00Z`).toISOString().split('T')[0] !== entry.date ||
			entry.date < startInput.value || entry.date > endInput.value
		) || new Set(entries.map((entry) => entry.date)).size !== 9) {
			throw new Error('NASA did not return all nine daily entries. Try an earlier nine-day range or try again later.');
		}
		// Do not present website branding as the astronomy image for each date.
		if (entries.some((entry) => entry.media_type === 'image' &&
			(getWebUrl(entry.hdurl) || getWebUrl(entry.url)) &&
			!(getApodImageUrl(entry.hdurl) || getApodImageUrl(entry.url)))) {
			throw new Error('NASA returned its website logo instead of daily astronomy images. The API data is currently unavailable. Please try again later.');
		}
		entries.sort((first, second) => first.date.localeCompare(second.date));
		displayEntries(entries);
		statusMessage.textContent = 'Showing nine daily entries.';
	} catch (error) {
		statusMessage.textContent = error.name === 'TimeoutError'
			? 'NASA took too long to respond. Please try again.'
			: error instanceof TypeError
				? 'Unable to reach the app server. Check that it is running and try again.'
				: error.message || 'Unable to load space images. Please try again.';
	} finally {
		getImagesButton.disabled = false;
		startInput.disabled = false;
		endInput.disabled = false;
		gallery.setAttribute('aria-busy', 'false');
	}
}

getImagesButton.addEventListener('click', getSpaceImages);
document.getElementById('closeModal').addEventListener('click', () => modal.close());
modal.addEventListener('click', (event) => {
	if (event.target === modal) {
		const bounds = modal.getBoundingClientRect();
		if (event.clientX < bounds.left || event.clientX > bounds.right ||
				event.clientY < bounds.top || event.clientY > bounds.bottom) modal.close();
	}
});
// Native dialogs handle Escape and keep keyboard focus inside while open.
modal.addEventListener('close', () => {
	modalMedia.replaceChildren();
	if (lastOpenedButton) lastOpenedButton.focus();
});
