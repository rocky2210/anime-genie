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
        statistics {
          anime { count meanScore }
          manga { count meanScore }
        }
      }
    }
  }
`;

const GET_USER = `
  query GetUser($name: String!) {
    User(name: $name) {
      id name about(asHtml: false) bannerImage siteUrl
      avatar { large medium }
      statistics {
        anime { count meanScore }
        manga { count meanScore }
      }
    }
  }
`;

// MediaListCollection supports chunk-based retrieval.
// hasNextChunk tells us whether more entries remain.
const MEDIA_LIST_COLLECTION = `
  query MediaListCollectionPage(
    $userId: Int!
    $type: MediaType!
    $chunk: Int!
    $perChunk: Int!
  ) {
    MediaListCollection(
      userId: $userId
      type: $type
      chunk: $chunk
      perChunk: $perChunk
    ) {
      hasNextChunk
      lists {
        entries {
          id status score(format: POINT_100) progress
          media {
            ${MEDIA_FIELDS}
          }
        }
      }
    }
  }
`;

export class AniListError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "AniListError";
    this.status = status;
  }
}

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const responseCache = new Map();
const inflight = new Map();

const CACHE_TTL = 60 * 60 * 1000;
const USER_CACHE_TTL = 5 * 60 * 1000;

// Keep one request per identical query/variables pair.
// Retry within the request operation instead of recursively
// calling gql(), which can deadlock on its own in-flight promise.
export async function gql(query, variables, maxAttempts = 5) {
  const key = JSON.stringify([query, variables]);

  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const request = (async () => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
        if (attempt === maxAttempts - 1) {
          throw new AniListError(
            "Cannot connect to AniList. Check your connection and try again.",
            0
          );
        }

        await sleep(Math.min(1000 * 2 ** attempt, 15000));
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        if (attempt === maxAttempts - 1) {
          throw new AniListError(
            res.status === 429
              ? "AniList rate limit reached. Please wait and try again."
              : "AniList server is temporarily unavailable.",
            res.status
          );
        }

        const retryHeader = Number(
          res.headers.get("Retry-After")
        );

        const delay =
          res.status === 429
            ? Number.isFinite(retryHeader) && retryHeader > 0
              ? retryHeader * 1000
              : Math.min(60000, 5000 * 2 ** attempt)
            : Math.min(15000, 1000 * 2 ** attempt);

        await sleep(delay);
        continue;
      }

      let json;

      try {
        json = await res.json();
      } catch {
        throw new AniListError(
          "AniList returned an invalid response.",
          res.status
        );
      }

      if (json.errors?.length) {
        const first = json.errors[0];
        const message =
          first?.message || "AniList GraphQL request failed.";

        // Some GraphQL errors may arrive with HTTP 200.
        const rateLimited =
          first?.status === 429 ||
          /rate.?limit|too many requests/i.test(message);

        if (rateLimited && attempt < maxAttempts - 1) {
          await sleep(Math.min(60000, 5000 * 2 ** attempt));
          continue;
        }

        throw new AniListError(
          message,
          rateLimited ? 429 : first?.status ?? res.status
        );
      }

      if (!res.ok || !json.data) {
        throw new AniListError(
          "AniList returned no usable data.",
          res.status
        );
      }

      return json.data;
    }

    throw new AniListError("AniList request failed.");
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

  const cacheKey = `users:${term.toLowerCase()}`;
  const cached = responseCache.get(cacheKey);

  if (cached && cached.expires > Date.now()) {
    return cached.value;
  }

  // Preserve both exact lookup and search suggestions.
  const [pageResult, exact] = await Promise.all([
    gql(SEARCH_USERS, { search: term }).catch((error) => {
      if (error.status === 429) throw error;
      return null;
    }),
    gql(GET_USER, { name: term }).catch((error) => {
      if (error.status === 429) throw error;
      return null;
    }),
  ]);

  const users = [];

  if (exact?.User) {
    users.push(exact.User);
  }

  for (const user of pageResult?.Page?.users ?? []) {
    if (user && !users.some((item) => item.id === user.id)) {
      users.push(user);
    }
  }

  responseCache.set(cacheKey, {
    value: users,
    expires: Date.now() + USER_CACHE_TTL,
  });

  return users;
}

// Fetch the complete list, combining all chunks and all status lists.
// Calls for the same user's list share one in-progress operation.
export async function fetchMediaList(userId, type, onProgress) {
  const cacheKey = `media:${userId}:${type}`;

  const cached = responseCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    onProgress?.(1, false, cached.value.length);
    return cached.value;
  }

  // Deduplicate the entire list download, not just individual requests.
  const flightKey = `complete:${cacheKey}`;

  if (inflight.has(flightKey)) {
    return inflight.get(flightKey);
  }

  const operation = (async () => {
    const entries = [];
    let chunk = 1;
    let hasNextChunk = true;

    // Request up to 500 entries per chunk.
    // If AniList rejects that size, lower PER_CHUNK to 100.
    const PER_CHUNK = 500;

    while (hasNextChunk) {
      const data = await gql(MEDIA_LIST_COLLECTION, {
        userId: Number(userId),
        type,
        chunk,
        perChunk: PER_CHUNK,
      });

      const collection = data?.MediaListCollection;

      if (!collection) {
        throw new AniListError(
          "AniList returned no media list collection."
        );
      }

      for (const list of collection.lists ?? []) {
        for (const entry of list.entries ?? []) {
          if (entry?.media) {
            entries.push(entry);
          }
        }
      }

      hasNextChunk = collection.hasNextChunk === true;

      onProgress?.(chunk, hasNextChunk, entries.length);

      if (hasNextChunk) {
        chunk++;
        // Avoid immediately sending the next request.
        await sleep(1500);
      }
    }

    // Cache only after every chunk has been retrieved successfully.
    responseCache.set(cacheKey, {
      value: entries,
      expires: Date.now() + CACHE_TTL,
    });

    return entries;
  })();

  inflight.set(flightKey, operation);

  try {
    return await operation;
  } finally {
    inflight.delete(flightKey);
  }
}
