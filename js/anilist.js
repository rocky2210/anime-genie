const ENDPOINT = "https://graphql.anilist.co";

const MEDIA_FIELDS = `
  id type format status episodes chapters volumes duration averageScore meanScore
  countryOfOrigin genres description(asHtml: false) siteUrl season seasonYear
  startDate { year } bannerImage coverImage { extraLarge large color }
  title { romaji english native }
`;

const SEARCH_USERS = `
  query SearchUsers($search: String!) {
    Page(page: 1, perPage: 6) {
      users(search: $search) {
        id name about(asHtml: false) bannerImage siteUrl
        avatar { large medium }
        statistics { anime { count meanScore } manga { count meanScore } }
      }
    }
  }
`;

const GET_USER = `
  query GetUser($name: String!) {
    User(name: $name) {
      id name about(asHtml: false) bannerImage siteUrl
      avatar { large medium }
      statistics { anime { count meanScore } manga { count meanScore } }
    }
  }
`;

const MEDIA_LIST_PAGE = `
  query MediaListPage($userId: Int!, $type: MediaType!, $page: Int!) {
    Page(page: $page, perPage: 50) {
      pageInfo { currentPage hasNextPage }
      mediaList(userId: $userId, type: $type, sort: MEDIA_ID) {
        id status score(format: POINT_100) progress
        media { ${MEDIA_FIELDS} }
      }
    }
  }
`;

export class AniListError extends Error {
	constructor(message, status = 500) {
		super(message);
		this.status = status;
	}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const responseCache = new Map();
const inflight = new Map();

export async function gql(query, variables, attempt = 0) {
	const key = JSON.stringify([query, variables]);
	if (inflight.has(key)) return inflight.get(key);

	const request = (async () => {
		let res;
		try {
			res = await fetch(ENDPOINT, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({ query, variables }),
			});
		} catch {
			throw new AniListError(
				"AniList is temporarily unavailable. Please try again.",
				0
			);
		}

		// Do not hammer AniList while rate limited. Honor Retry-After once.
		if (res.status === 429) {
			const retryAfter = Number(res.headers.get("retry-after"));
			if (
				attempt === 0 &&
				Number.isFinite(retryAfter) &&
				retryAfter > 0 &&
				retryAfter <= 10
			) {
				await sleep(retryAfter * 1000);
				return gql(query, variables, 1);
			}
			throw new AniListError(
				"AniList rate limit reached. Please wait a moment and try again.",
				429
			);
		}

		if (res.status >= 500 && attempt < 2) {
			await sleep(1000 * (attempt + 1));
			return gql(query, variables, attempt + 1);
		}

		let json;
		try {
			json = await res.json();
		} catch {
			throw new AniListError(
				"AniList is temporarily unavailable. Please try again.",
				res.status
			);
		}

		if (json.errors?.length) {
			const first = json.errors[0];
			throw new AniListError(
				first?.message || "AniList request failed",
				first?.status ?? res.status
			);
		}
		if (!json.data)
			throw new AniListError(
				"AniList returned no data. Please try again.",
				res.status
			);
		return json.data;
	})();

	inflight.set(key, request);
	try {
		return await request;
	} finally {
		inflight.delete(key);
	}
}

export async function searchUsers(search) {
	const term = search.trim();
	if (!term) return [];

	const key = `users:${term.toLowerCase()}`;
	const cached = responseCache.get(key);
	if (cached && cached.expires > Date.now()) return cached.value;

	const [pageResult, exact] = await Promise.all([
		gql(SEARCH_USERS, { search: term }).catch((e) =>
			e.status === 429 ? Promise.reject(e) : null
		),
		gql(GET_USER, { name: term }).catch((e) =>
			e.status === 429 ? Promise.reject(e) : null
		),
	]);

	const users = [];
	if (exact?.User) users.push(exact.User);
	for (const u of pageResult?.Page?.users ?? []) {
		if (u && !users.some((x) => x.id === u.id)) users.push(u);
	}

	responseCache.set(key, { value: users, expires: Date.now() + 5 * 60_000 });
	return users;
}

export async function fetchMediaList(userId, type, onProgress) {
	const cacheKey = `media:${userId}:${type}`;
	const cached = responseCache.get(cacheKey);
	if (cached && cached.expires > Date.now()) return cached.value;

	const entries = [];
	let page = 1;
	for (;;) {
		const data = await gql(MEDIA_LIST_PAGE, { userId, type, page });
		for (const entry of data.Page.mediaList ?? [])
			if (entry?.media) entries.push(entry);
		onProgress?.(
			page,
			data.Page.pageInfo?.hasNextPage ?? false,
			entries.length
		);
		if (!data.Page.pageInfo?.hasNextPage || page >= 60) break;
		page++;
		await sleep(120);
	}

	// React version effectively keeps media lists cached for the session.
	responseCache.set(cacheKey, {
		value: entries,
		expires: Date.now() + 60 * 60_000,
	});
	return entries;
}
