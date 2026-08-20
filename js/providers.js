import * as AniList from "./anilist.js";

/* =========================================================
   COMMON HELPERS
========================================================= */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cache = new Map();
const inflight = new Map();

class ProviderError extends Error {
	constructor(message, status = 0) {
		super(message);
		this.name = "ProviderError";
		this.status = status;
	}
}

async function fetchWithTimeout(url, options = {}, timeout = 12000) {
	const controller = new AbortController();

	const timer = setTimeout(() => controller.abort(), timeout);

	try {
		return await fetch(url, {
			...options,

			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}
}

async function cached(key, fn, ttl = 300000) {
	const old = cache.get(key);

	if (old && old.expires > Date.now()) {
		return old.value;
	}

	if (inflight.has(key)) {
		return inflight.get(key);
	}

	const promise = Promise.resolve()
		.then(fn)
		.then((value) => {
			cache.set(key, {
				value,
				expires: Date.now() + ttl,
			});

			return value;
		})
		.finally(() => {
			inflight.delete(key);
		});

	inflight.set(key, promise);

	return promise;
}

async function fetchJson(url, headers = {}) {
	const res = await fetchWithTimeout(url, {
		method: "GET",

		headers: {
			Accept: "application/json",

			...headers,
		},
	});

	if (!res.ok) {
		throw new ProviderError(`Request failed (${res.status}).`, res.status);
	}

	return res.json();
}

/* =========================================================
   JIKAN API
========================================================= */

/*
 * Jikan:
 *
 * https://api.jikan.moe/v4/
 *
 * Jikan is an unofficial MyAnimeList API.
 *
 * This frontend only performs GET requests.
 *
 * Temporary 5xx responses are retried a limited number
 * of times. We do NOT retry forever.
 */

async function jikan(path, params = {}, attempt = 0) {
	const query = new URLSearchParams(params);

	const qs = query.toString();

	const url = `https://api.jikan.moe/v4/${path}` + (qs ? `?${qs}` : "");

	let res;

	try {
		res = await fetchWithTimeout(
			url,
			{
				method: "GET",
				headers: {
					Accept: "application/json",
				},
			},
			5000
		);
	} catch {
		if (attempt < 3) {
			await sleep(750 * (attempt + 1));

			return jikan(path, params, attempt + 1);
		}

		throw new ProviderError(
			"Jikan is temporarily unavailable. Please try again.",
			503
		);
	}

	/* -------------------------------------------------------
     RATE LIMIT
  ------------------------------------------------------- */

	if (res.status === 429) {
		const retryAfter = Number(res.headers.get("retry-after"));

		if (
			attempt === 0 &&
			Number.isFinite(retryAfter) &&
			retryAfter > 0 &&
			retryAfter <= 10
		) {
			await sleep(retryAfter * 1000);

			return jikan(path, params, attempt + 1);
		}

		throw new ProviderError(
			"Jikan rate limit reached. Please wait a moment and try again.",
			429
		);
	}

	/* -------------------------------------------------------
     TEMPORARY SERVER ERRORS
  ------------------------------------------------------- */

	if ([500, 502, 503, 504].includes(res.status) && attempt < 3) {
		await sleep(750 * (attempt + 1));

		return jikan(path, params, attempt + 1);
	}

	/* -------------------------------------------------------
     OTHER HTTP ERRORS
  ------------------------------------------------------- */

	if (!res.ok) {
		let message = `Jikan request failed (${res.status}).`;

		try {
			const errorData = await res.json();

			if (errorData?.message) {
				message = `Jikan: ${errorData.message}`;
			}
		} catch {
			// Keep default message.
		}

		throw new ProviderError(message, res.status);
	}

	/* -------------------------------------------------------
     JSON RESPONSE
  ------------------------------------------------------- */

	try {
		return await res.json();
	} catch {
		throw new ProviderError(
			"Jikan returned an invalid response. Please try again.",
			502
		);
	}
}

/* =========================================================
   KITSU API
========================================================= */

/*
 * Kitsu uses JSON:API style query parameters.
 *
 * Example:
 *
 * filter[name]=lilarocky
 * page[limit]=6
 *
 * URLSearchParams will correctly encode the brackets.
 */

async function kitsu(path, params = {}) {
	const query = new URLSearchParams();

	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null) {
			continue;
		}

		query.append(key, String(value));
	}

	const qs = query.toString();

	const url = `https://kitsu.io/api/edge/${path}` + (qs ? `?${qs}` : "");

	let res;

	try {
		res = await fetchWithTimeout(url, {
			method: "GET",

			headers: {
				Accept: "application/vnd.api+json",
			},
		});
	} catch {
		throw new ProviderError(
			"Kitsu is temporarily unavailable. Please try again.",
			503
		);
	}

	if (res.status === 429) {
		throw new ProviderError(
			"Kitsu rate limit reached. Please wait a moment and try again.",
			429
		);
	}

	if (!res.ok) {
		let message = `Kitsu request failed (${res.status}).`;

		try {
			const errorData = await res.json();

			const apiMessage =
				errorData?.errors?.[0]?.detail ||
				errorData?.errors?.[0]?.title ||
				errorData?.message;

			if (apiMessage) {
				message = `Kitsu: ${apiMessage}`;
			}
		} catch {
			// Keep default message.
		}

		throw new ProviderError(message, res.status);
	}

	try {
		return await res.json();
	} catch {
		throw new ProviderError(
			"Kitsu returned an invalid response. Please try again.",
			502
		);
	}
}

/* =========================================================
   MAL USER NORMALIZER
========================================================= */

function normalizeMALUser(user) {
	if (!user) {
		return null;
	}

	return {
		id: user.mal_id,

		name: user.username || "",

		siteUrl: `https://myanimelist.net/profile/${encodeURIComponent(
			user.username || ""
		)}`,

		avatar: {
			large: user.images?.jpg?.image_url || "",

			medium: user.images?.jpg?.image_url || "",
		},

		statistics: {
			anime: {
				count: 0,
				meanScore: 0,
			},

			manga: {
				count: 0,
				meanScore: 0,
			},
		},
	};
}

function fallbackMALUser(username) {
	return {
		id: `mal-${username.toLowerCase()}`,

		name: username,

		siteUrl: `https://myanimelist.net/profile/${encodeURIComponent(username)}`,

		avatar: {
			large: "",

			medium: "",
		},

		statistics: {
			anime: {
				count: 0,
				meanScore: 0,
			},

			manga: {
				count: 0,
				meanScore: 0,
			},
		},
	};
}

/* =========================================================
   MAL USER SEARCH
========================================================= */

/*
 * Instead of:
 *
 * /users?q=username
 *
 * we use Jikan's documented exact username endpoint:
 *
 * /users/{username}
 */

async function malSearch(term) {
	const username = term.trim();

	if (!username) {
		return [];
	}

	const encoded = encodeURIComponent(username);

	let exactError = null;

	try {
		const data = await jikan(`users/${encoded}`);

		const user = normalizeMALUser(data?.data);

		return user ? [user] : [];
	} catch (error) {
		exactError = error;

		if (error?.status === 429) {
			throw error;
		}
	}

	try {
		const fallback = await jikan("users", {
			q: username,

			limit: 6,
		});

		const users = (fallback?.data || [])
			.map(normalizeMALUser)
			.filter(Boolean)
			.sort((a, b) => {
				const aExact = a.name.toLowerCase() === username.toLowerCase();

				const bExact = b.name.toLowerCase() === username.toLowerCase();

				return Number(bExact) - Number(aExact);
			});

		if (users.length) {
			return users;
		}
	} catch (error) {
		if (error?.status === 429) {
			throw error;
		}
	}

	if (exactError && ![404, 500, 502, 503, 504].includes(exactError.status)) {
		throw exactError;
	}

	return [fallbackMALUser(username)];
}

/* =========================================================
   MAL / JIKAN MEDIA LIST
========================================================= */

async function malList(user, type, onProgress) {
	if (!user?.name) {
		throw new Error("MyAnimeList username is missing.");
	}

	const username = encodeURIComponent(user.name);

	const endpoint =
		type === "ANIME"
			? `users/${username}/animelist`
			: `users/${username}/mangalist`;

	const out = [];

	let page = 1;

	try {
		for (;;) {
			const data = await jikan(endpoint, {
				page,
				limit: 300,
				sort: "list_score",
			});

			for (const item of data?.data || []) {
				out.push(normalizeJikan(item, type));
			}

			const hasNextPage = !!data?.pagination?.has_next_page;

			onProgress?.(page, hasNextPage, out.length);

			if (!hasNextPage) {
				break;
			}

			page++;

			await sleep(350);
		}

		return out;
	} catch (error) {
		if (![500, 502, 503, 504].includes(error?.status)) {
			throw error;
		}
	}

	return malLoadJsonList(user, type, onProgress);
}

async function malLoadJsonList(user, type, onProgress) {
	const username = encodeURIComponent(user.name);

	const listPath = type === "ANIME" ? "animelist" : "mangalist";

	const out = [];
	const limit = 300;

	let offset = 0;
	let page = 1;

	for (;;) {
		const targetUrl =
			`https://myanimelist.net/${listPath}/${username}/load.json` +
			`?offset=${offset}&status=7`;

		const data = await fetchMALLoadJsonPage(targetUrl);

		for (const item of data || []) {
			out.push(normalizeMALLoadJson(item, type));
		}

		const hasNext = Array.isArray(data) && data.length >= limit;

		onProgress?.(page, hasNext, out.length);

		if (!hasNext) {
			break;
		}

		offset += limit;
		page++;

		await sleep(350);
	}

	return out;
}

async function fetchMALLoadJsonPage(targetUrl) {
	const allOriginsGetUrl =
		"https://api.allorigins.win/get?url=" + encodeURIComponent(targetUrl);

	try {
		const data = await fetchJson(allOriginsGetUrl);

		return JSON.parse(data.contents || "[]");
	} catch {
		// Fall through to the alternate routes below.
	}

	const allOriginsRawUrl =
		"https://api.allorigins.win/raw?url=" + encodeURIComponent(targetUrl);

	try {
		return await fetchJson(allOriginsRawUrl);
	} catch {
		// Direct MAL works outside browser CORS and in same-origin backend setups.
	}

	return fetchJson(targetUrl);
}

/* =========================================================
   NORMALIZE JIKAN MEDIA
========================================================= */

function normalizeJikan(item, type) {
	const entry = item?.entry || {};

	const media = {
		id: entry.mal_id,

		type,

		format: type === "ANIME" ? (entry.type || "").toUpperCase() : "MANGA",

		status: (item?.status || "").toUpperCase(),

		episodes: entry.episodes ?? null,

		chapters: entry.chapters ?? null,

		volumes: entry.volumes ?? null,

		duration: entry.duration ?? null,

		averageScore: item?.score ?? null,

		meanScore: item?.score ?? null,

		countryOfOrigin: "JP",

		genres: (entry.genres || []).map((genre) => genre.name),

		description: entry.synopsis || "",

		siteUrl:
			entry.url ||
			`https://myanimelist.net/${type.toLowerCase()}/${entry.mal_id}`,

		season: null,

		seasonYear: entry.year ?? null,

		startDate: {
			year: entry.year ?? null,
		},

		bannerImage: entry.images?.jpg?.large_image_url || "",

		coverImage: {
			extraLarge:
				entry.images?.jpg?.large_image_url ||
				entry.images?.jpg?.image_url ||
				"",

			large: entry.images?.jpg?.image_url || "",

			color: null,
		},

		title: {
			romaji: entry.title || "",

			english: entry.title_english || entry.title || "",

			native: entry.title_japanese || entry.title || "",
		},
	};

	const statusMap = {
		WATCHING: "CURRENT",
		COMPLETED: "COMPLETED",
		"PLAN TO WATCH": "PLANNING",
		"ON-HOLD": "PAUSED",
		DROPPED: "DROPPED",

		READING: "CURRENT",
		"PLAN TO READ": "PLANNING",
	};

	return {
		id: `mal-${media.id}-${type}`,

		status: statusMap[item?.status] || "PLANNING",

		score: item?.score || 0,

		progress: item?.progress || 0,

		media,
	};
}

function parseMALDateYear(value) {
	if (!value) {
		return null;
	}

	const text = String(value);

	const match = text.match(/(\d{2})$/);

	if (!match) {
		return null;
	}

	const year = Number(match[1]);

	if (!Number.isFinite(year)) {
		return null;
	}

	const currentTwoDigitYear = new Date().getFullYear() % 100;

	return year > currentTwoDigitYear + 1 ? 1900 + year : 2000 + year;
}

function normalizeMALLoadJson(item, type) {
	const isAnime = type === "ANIME";

	const id = isAnime ? item.anime_id : item.manga_id;

	const title = isAnime ? item.anime_title : item.manga_title;

	const english = isAnime ? item.anime_title_eng : item.manga_english;

	const image = isAnime ? item.anime_image_path : item.manga_image_path;

	const url = isAnime ? item.anime_url : item.manga_url;

	const format = isAnime
		? item.anime_media_type_string
		: item.manga_media_type_string;

	const averageScore = isAnime ? item.anime_score_val : item.manga_score_val;

	const startYear = parseMALDateYear(
		isAnime ? item.anime_start_date_string : item.manga_start_date_string
	);

	const normalizedFormat = (format || (isAnime ? "TV" : "MANGA")).toUpperCase();

	const lowerFormat = normalizedFormat.toLowerCase();

	const statusMap = {
		1: "CURRENT",

		2: "COMPLETED",

		3: "PAUSED",

		4: "DROPPED",

		6: "PLANNING",
	};

	const progress = isAnime ? item.num_watched_episodes : item.num_read_chapters;

	const media = {
		id,

		type,

		format: normalizedFormat,

		status: "",

		episodes: isAnime ? item.anime_num_episodes ?? null : null,

		chapters: isAnime ? null : item.manga_num_chapters ?? null,

		volumes: isAnime ? null : item.manga_num_volumes ?? null,

		duration: null,

		averageScore: averageScore ? Number(averageScore) * 10 : null,

		meanScore: averageScore ? Number(averageScore) * 10 : null,

		countryOfOrigin: lowerFormat.includes("manhwa")
			? "KR"
			: lowerFormat.includes("manhua")
			? "CN"
			: "JP",

		genres: (item.genres || []).map((genre) => genre.name),

		description: "",

		siteUrl: url
			? `https://myanimelist.net${url}`
			: `https://myanimelist.net/${isAnime ? "anime" : "manga"}/${id}`,

		season: null,

		seasonYear: startYear,

		startDate: {
			year: startYear,
		},

		bannerImage: "",

		coverImage: {
			extraLarge: image || "",

			large: image || "",

			color: null,
		},

		title: {
			romaji: title || "",

			english: english || title || "",

			native: "",
		},
	};

	return {
		id: `mal-${media.id}-${type}`,

		status: statusMap[item.status] || "PLANNING",

		score: item.score ? Number(item.score) * 10 : 0,

		progress: progress || 0,

		media,
	};
}

/* =========================================================
   KITSU USER SEARCH
========================================================= */

/*
 * Kitsu JSON:API query:
 *
 * filter[name]=username
 * page[limit]=6
 */

async function kitsuSearch(term) {
	const username = term.trim();

	if (!username) {
		return [];
	}

	const normalizeUser = (user) => ({
		id: user.id,

		name: user.attributes?.name || user.attributes?.slug || user.id,

		siteUrl: `https://kitsu.app/users/${user.attributes?.slug || user.id}`,

		avatar: {
			large: user.attributes?.avatar?.original || "",

			medium: user.attributes?.avatar?.tiny || "",
		},

		statistics: {
			anime: {
				count: 0,
				meanScore: 0,
			},

			manga: {
				count: 0,
				meanScore: 0,
			},
		},
	});

	if (/^\d+$/.test(username)) {
		try {
			const data = await kitsu(`users/${encodeURIComponent(username)}`);

			return data?.data ? [normalizeUser(data.data)] : [];
		} catch (error) {
			if (error?.status !== 404) {
				throw error;
			}
		}
	}

	const users = [];
	const seen = new Set();

	const searches = [
		{
			"filter[name]": username,
		},
		{
			"filter[slug]": username,
		},
		{
			"filter[slug]": username.toLowerCase(),
		},
	];

	for (const params of searches) {
		const data = await kitsu("users", {
			...params,

			"page[limit]": 6,
		});

		for (const user of data?.data || []) {
			if (seen.has(user.id)) {
				continue;
			}

			seen.add(user.id);

			users.push(normalizeUser(user));
		}

		if (users.length) {
			break;
		}
	}

	return users;
}

/* =========================================================
   KITSU MEDIA LIST
========================================================= */

async function kitsuList(user, type, onProgress) {
	if (!user?.id) {
		throw new Error("Kitsu user ID is missing.");
	}

	const kind = type === "ANIME" ? "anime" : "manga";

	const out = [];

	let offset = 0;

	const limit = 20;

	for (;;) {
		const data = await kitsu("library-entries", {
			"filter[user_id]": user.id,

			"filter[kind]": kind,

			include: kind,

			"page[limit]": limit,

			"page[offset]": offset,
		});

		const included = new Map(
			(data?.included || []).map((item) => [item.id, item])
		);

		for (const item of data?.data || []) {
			const relationship = item.relationships?.[kind]?.data;

			const raw = relationship ? included.get(relationship.id) : null;

			if (raw) {
				out.push(normalizeKitsu(item, raw, type));
			}
		}

		const hasNext = !!data?.links?.next;

		onProgress?.(offset / limit + 1, hasNext, out.length);

		if (!hasNext) {
			break;
		}

		offset += limit;

		await sleep(250);
	}

	return out;
}

/* =========================================================
   NORMALIZE KITSU MEDIA
========================================================= */

function normalizeKitsu(entry, raw, type) {
	const attributes = raw?.attributes || {};

	const englishTitle = attributes.titles?.en || attributes.canonicalTitle || "";

	const romajiTitle =
		attributes.titles?.en_jp || attributes.canonicalTitle || englishTitle || "";

	const nativeTitle = attributes.titles?.ja_jp || "";

	const title = englishTitle || romajiTitle || nativeTitle || "Untitled";

	const statusMap = {
		current: "CURRENT",

		completed: "COMPLETED",

		planned: "PLANNING",

		on_hold: "PAUSED",

		dropped: "DROPPED",
	};

	const startYear = attributes.startDate
		? Number(String(attributes.startDate).slice(0, 4))
		: null;

	const media = {
		id: raw.id,

		type,

		format: (attributes.subtype || "").toUpperCase(),

		status: "",

		episodes: attributes.episodeCount ?? null,

		chapters: attributes.chapterCount ?? null,

		volumes: attributes.volumeCount ?? null,

		duration: attributes.episodeLength ?? null,

		averageScore: attributes.averageRating
			? Number(attributes.averageRating)
			: null,

		meanScore: attributes.averageRating
			? Number(attributes.averageRating)
			: null,

		countryOfOrigin: "JP",

		genres: [],

		description: attributes.synopsis || "",

		siteUrl: `https://kitsu.app/${type === "ANIME" ? "anime" : "manga"}/${
			attributes.slug || raw.id
		}`,

		season: null,

		seasonYear: startYear,

		startDate: {
			year: startYear,
		},

		bannerImage: attributes.coverImage?.original || "",

		coverImage: {
			extraLarge:
				attributes.posterImage?.large || attributes.posterImage?.original || "",

			large: attributes.posterImage?.small || "",

			color: null,
		},

		title: {
			romaji: romajiTitle || title,

			english: englishTitle || title,

			native: nativeTitle,
		},
	};

	return {
		id: `kitsu-${media.id}`,

		status: statusMap[entry?.attributes?.status] || "PLANNING",

		score: entry?.attributes?.rating ? Number(entry.attributes.rating) : 0,

		progress: entry?.attributes?.progress || 0,

		media,
	};
}

/* =========================================================
   PROVIDERS
========================================================= */

export const Providers = {
	/* -------------------------------------------------------
     ANILIST
  ------------------------------------------------------- */

	anilist: {
		label: "AniList",

		icon: "database",

		searchUsers: (term) =>
			cached(
				"al:user:" + term.toLowerCase(),

				() => AniList.searchUsers(term),

				300000
			),

		fetchMediaList: (user, type, onProgress) =>
			AniList.fetchMediaList(user.id, type, onProgress),
	},

	/* -------------------------------------------------------
     MYANIMELIST
  ------------------------------------------------------- */

	mal: {
		label: "MyAnimeList",

		icon: "globe",

		searchUsers: (term) =>
			cached(
				"mal:user:" + term.toLowerCase(),

				() => malSearch(term),

				300000
			),

		fetchMediaList: (user, type, onProgress) =>
			cached(
				`mal:list:${user.id}:${type}`,

				() => malList(user, type, onProgress),

				3600000
			),
	},

	/* -------------------------------------------------------
     KITSU
  ------------------------------------------------------- */

	kitsu: {
		label: "Kitsu",

		icon: "layers-3",

		searchUsers: (term) =>
			cached(
				"kitsu:user:" + term.toLowerCase(),

				() => kitsuSearch(term),

				300000
			),

		fetchMediaList: (user, type, onProgress) =>
			cached(
				`kitsu:list:${user.id}:${type}`,

				() => kitsuList(user, type, onProgress),

				3600000
			),
	},
};
