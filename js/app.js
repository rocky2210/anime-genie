import { AniListError } from "./anilist.js";
import { Providers } from "./providers.js";
import {
	initSurpriseUI,
	generateSurprisePick,
	getSurprisePreset,
} from "./surprise.js";
import {
	initSurpriseHistoryUI,
	addSurpriseHistoryEntry,
	setSurpriseHistoryMode,
} from "./surprise-history.js";
import {
	STATUS_OPTIONS,
	ANIME_FORMATS,
	MANGA_FORMATS,
	COUNTRIES,
	GENRES,
	defaultFilters,
	statusLabel,
	entryStatusLabel,
	countryFlavour,
	applyFilters,
	pickRandom,
	shuffleSample,
} from "./filters.js";

/* =========================================================
   DOM HELPER
========================================================= */

const $ = (selector) => document.querySelector(selector);

/* =========================================================
   APP STATE
========================================================= */

let state = {
	mode: "user",
	provider: "anilist",
	term: "",
	user: null,
	searchResults: [],

	filters: defaultFilters(),

	allEntries: [],
	result: null,
	reel: null,

	spinning: false,
	loading: false,
	searching: false,
	filtersOpen: false,

	timers: [],

	cache: new Map(),
};

/* =========================================================
   PROVIDER
========================================================= */

function renderProvider() {
	const select = $("#provider-select");

	if (!select) return;

	const labels = Object.entries(Providers)
		.map(([key, provider]) => {
			return `
        <option value="${key}" ${state.provider === key ? "selected" : ""}>
          ${provider.label}
        </option>
      `;
		})
		.join("");

	select.innerHTML = labels;
}

function updateProviderNote() {
	const note = $("#provider-note");

	if (!note) return;

	if (state.provider === "mal") {
		note.textContent =
			"MyAnimeList data is accessed through Jikan. No MAL API secret is exposed in this frontend.";
	} else if (state.provider === "kitsu") {
		note.textContent =
			"Kitsu public API data is accessed directly from the browser.";
	} else {
		note.textContent = "Direct AniList GraphQL API.";
	}
}

/* =========================================================
   HELPERS
========================================================= */

function chip(label, active, action) {
	return `
    <button
      type="button"
      class="chip ${active ? "active" : ""}"
      data-action="${action}"
    >
      ${label}
    </button>
  `;
}

function checkChip(label, active, key, value) {
	return `
    <button
      type="button"
      class="check-chip ${active ? "active" : ""}"
      data-check="${key}"
      data-value="${value}"
    >
      <span class="check-box">${active ? "✓" : ""}</span>
      ${label}
    </button>
  `;
}

function numberField(label, key, placeholder = "") {
	return `
    <label class="flex flex-col gap-1.5 text-xs font-medium text-slate-400">
      ${label}

      <input
        data-field="${key}"
        type="number"
        inputmode="numeric"
        value="${esc(state.filters[key])}"
        placeholder="${placeholder}"
        class="w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/30"
      >
    </label>
  `;
}

function esc(value) {
	return String(value ?? "").replace(
		/[&<>"']/g,
		(match) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			}[match])
	);
}

function refreshIcons() {
	if (window.lucide) {
		window.lucide.createIcons();
	}
}

/* =========================================================
   FILTER UI
========================================================= */

function renderMediaStatus() {
	const media = $("#media-chips");
	const status = $("#status-chips");
	const statusSection = $("#status-filter-section");

	if (!media || !status) return;

	media.innerHTML = [
		chip(
			`<i data-lucide="tv" class="size-3.5 inline"></i> Anime`,
			state.filters.media === "ANIME",
			"media:ANIME"
		),

		chip(
			`<i data-lucide="book-open" class="size-3.5 inline"></i> Manga`,
			state.filters.media === "MANGA",
			"media:MANGA"
		),

		chip(
			`<i data-lucide="shuffle" class="size-3.5 inline"></i> Both`,
			state.filters.media === "BOTH",
			"media:BOTH"
		),
	].join("");

	status.innerHTML = STATUS_OPTIONS.map((item) =>
		chip(
			`${item.icon} ${statusLabel(item.value, state.filters.media)}`,
			state.filters.status === item.value,
			`status:${item.value}`
		)
	).join("");

	if (statusSection) {
		statusSection.classList.toggle("hidden", state.mode === "random");
	}
}

function activeCount() {
	const f = state.filters;

	let count =
		f.animeFormats.length +
		f.mangaFormats.length +
		f.genres.length +
		f.countries.length;

	for (const value of [
		f.minEpisodes,
		f.maxEpisodes,
		f.minChapters,
		f.maxChapters,
		f.minVolumes,
		f.yearFrom,
		f.yearTo,
	]) {
		if (String(value).trim()) {
			count++;
		}
	}

	if (f.minScore > 0) {
		count++;
	}

	for (const value of [
		f.excludeMovies,
		f.excludeShorts,
		f.excludeSpecials,
		f.excludeMusic,
		f.excludeOneShots,
		f.excludeNovels,
		f.excludeNoScore,
		f.excludeNoCover,
	]) {
		if (value) {
			count++;
		}
	}

	return count;
}

function renderAdvanced() {
	const f = state.filters;

	const showAnime = f.media !== "MANGA";
	const showManga = f.media !== "ANIME";

	let html = "";

	/* =========================
     ANIME
  ========================= */

	if (showAnime) {
		html += `
      <div class="space-y-3">

        <h4 class="text-xs font-semibold uppercase tracking-[.16em] text-slate-400">
          Anime format
        </h4>

        <div class="flex flex-wrap gap-2">
          ${ANIME_FORMATS.map((item) =>
						checkChip(
							item[1],
							f.animeFormats.includes(item[0]),
							"animeFormats",
							item[0]
						)
					).join("")}
        </div>

        <div class="grid grid-cols-2 gap-3 sm:max-w-sm">
          ${numberField("Min episodes", "minEpisodes", "1")}
          ${numberField("Max episodes", "maxEpisodes", "24")}
        </div>

      </div>
    `;
	}

	/* =========================
     MANGA
  ========================= */

	if (showManga) {
		html += `
      <div class="space-y-3">

        <h4 class="text-xs font-semibold uppercase tracking-[.16em] text-slate-400">
          Manga format
        </h4>

        <div class="flex flex-wrap gap-2">
          ${MANGA_FORMATS.map((item) =>
						checkChip(
							item[1],
							f.mangaFormats.includes(item[0]),
							"mangaFormats",
							item[0]
						)
					).join("")}
        </div>

        <p class="text-xs text-slate-500">
          Manhwa / Manhua are Manga with a country of origin.
          Pick them below.
        </p>

        <div class="flex flex-wrap gap-2">
          ${COUNTRIES.map((item) =>
						checkChip(
							item[1],
							f.countries.includes(item[0]),
							"countries",
							item[0]
						)
					).join("")}
        </div>

        <div class="grid grid-cols-2 gap-3 sm:max-w-lg sm:grid-cols-3">
          ${numberField("Min chapters", "minChapters")}
          ${numberField("Max chapters", "maxChapters")}
          ${numberField("Min volumes", "minVolumes")}
        </div>

      </div>
    `;
	}

	/* =========================
     GENRES
  ========================= */

	html += `
    <div class="space-y-3">

      <h4 class="text-xs font-semibold uppercase tracking-[.16em] text-slate-400">
        Genres
      </h4>

      <div class="flex flex-wrap gap-2">
        ${GENRES.map((genre) =>
					checkChip(genre, f.genres.includes(genre), "genres", genre)
				).join("")}
      </div>

    </div>
  `;

	/* =========================
     SCORE + YEAR
  ========================= */

	if (state.mode !== "random") {
		html += `
      <div class="space-y-3">

        <h4 class="text-xs font-semibold uppercase tracking-[.16em] text-slate-400">
          Score & year
        </h4>

        <div class="max-w-sm space-y-2">

          <div class="flex items-center justify-between text-xs text-slate-400">
            <span>Minimum score</span>

            <span class="font-semibold text-white">
              ${
								f.minScore === 0
									? "Any"
									: (f.minScore / 10).toFixed(1) + " / 10"
							}
            </span>
          </div>

          <input
            id="score-range"
            type="range"
            min="0"
            max="100"
            step="5"
            value="${f.minScore}"
            class="w-full"
          >

        </div>

        <div class="grid grid-cols-2 gap-3 sm:max-w-sm">
          ${numberField("Year from", "yearFrom", "2010")}
          ${numberField("Year to", "yearTo", "2026")}
        </div>

      </div>
    `;
	}

	/* =========================
     EXCLUDE
  ========================= */

	html += `
    <div class="space-y-3">

      <h4 class="text-xs font-semibold uppercase tracking-[.16em] text-slate-400">
        Exclude
      </h4>

      <div class="flex flex-wrap gap-2">
  `;

	if (showAnime) {
		for (const [key, label] of [
			["excludeMovies", "Movies"],
			["excludeShorts", "Short anime"],
			["excludeSpecials", "Specials"],
			["excludeMusic", "Music"],
		]) {
			html += checkChip(label, f[key], key, "true");
		}
	}

	if (showManga) {
		for (const [key, label] of [
			["excludeOneShots", "One shots"],
			["excludeNovels", "Novels"],
		]) {
			html += checkChip(label, f[key], key, "true");
		}
	}

	for (const [key, label] of [
		["excludeNoScore", "Entries with no score"],
		["excludeNoCover", "Entries with no cover"],
	]) {
		html += checkChip(label, f[key], key, "true");
	}

	html += `</div>`;

	if (showAnime && f.excludeShorts) {
		html += `
      <div class="max-w-[220px]">
        ${numberField(
					"Exclude anime shorter than (episodes)",
					"shortEpisodeLimit",
					"6"
				)}
      </div>
    `;
	}

	html += `</div>`;

	const advanced = $("#advanced-filters");

	if (advanced) {
		advanced.innerHTML = html;
	}

	const active = $("#active-count");

	if (active) {
		const count = activeCount();

		active.textContent = `${count} active`;
		active.classList.toggle("hidden", count === 0);
	}
}

function renderFilters() {
	renderMediaStatus();
	renderAdvanced();
	refreshIcons();
}

/* =========================================================
   USER CARDS
========================================================= */

function userCard(user, selected) {
	const avatar =
		user.avatar?.large ||
		user.avatar?.medium ||
		"https://placehold.co/64x64/1c2130/8a94a6?text=?";

	return `
    <button
      type="button"
      class="user-card flex w-full items-center gap-4 rounded-2xl border p-3 text-left transition ${
				selected
					? "border-emerald-400/60 bg-emerald-400/10 shadow-glow"
					: "border-white/10 bg-white/[.025] hover:border-emerald-400/40 hover:bg-white/[.05]"
			}"
      data-user="${user.id}"
    >

      <img
        src="${avatar}"
        alt=""
        class="size-14 shrink-0 rounded-xl object-cover"
      >

      <div class="min-w-0 flex-1">

        <p class="truncate text-base font-semibold text-white">
          ${esc(user.name)}
        </p>

        <p class="mt-0.5 text-xs text-slate-400">
          🎬 Anime: ${user.statistics?.anime?.count ?? 0}
          •
          📚 Manga: ${user.statistics?.manga?.count ?? 0}
        </p>

        ${
					user.siteUrl
						? `
              <a
                href="${user.siteUrl}"
                target="_blank"
                rel="noreferrer"
                onclick="event.stopPropagation()"
                class="mt-1 inline-block text-xs font-medium text-emerald-300 hover:underline"
              >
                Profile ↗
              </a>
            `
						: ""
				}

      </div>

      ${
				selected
					? `
            <span class="shrink-0 rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-200">
              Selected
            </span>
          `
					: ""
			}

    </button>
  `;
}

function skeletonUsers() {
	return `
    <div class="grid gap-3">

      ${[0, 1, 2]
				.map(
					() => `
            <div class="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[.02] p-3">

              <div class="skeleton size-14 shrink-0"></div>

              <div class="flex-1 space-y-2">
                <div class="skeleton h-4 w-32"></div>
                <div class="skeleton h-3 w-48"></div>
              </div>

            </div>
          `
				)
				.join("")}

    </div>
  `;
}

/* =========================================================
   SEARCH USER
========================================================= */

async function search() {
	const input = $("#username-input");

	if (!input) return;

	const term = input.value.trim();

	state.term = term;

	if (!term) {
		const message = $("#search-message");

		if (message) {
			message.innerHTML = `
        <p class="text-sm text-red-400">
          Enter a username first.
        </p>
      `;
		}

		return;
	}

	if (state.searching) return;

	/* =========================
     START LOADING
  ========================= */

	state.searching = true;

	const searchButton = $("#search-btn");

	if (searchButton) {
		searchButton.disabled = true;
	}

	const searchIcon = $("#search-icon");

	if (searchIcon) {
		searchIcon.innerHTML = `
      <i
        data-lucide="loader-circle"
        class="size-4 animate-spin"
      ></i>
    `;

		refreshIcons();
	}

	const message = $("#search-message");
	const results = $("#user-results");

	if (message) {
		message.innerHTML = "";
	}

	if (results) {
		results.innerHTML = skeletonUsers();
	}

	/* =========================
     API SEARCH
  ========================= */

	try {
		const provider = Providers[state.provider];

		if (!provider) {
			throw new Error("Invalid data provider selected.");
		}

		const users = await provider.searchUsers(term);

		state.searchResults = users ?? [];

		if (!state.searchResults.length) {
			if (results) {
				results.innerHTML = `
          <p class="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-4 text-sm text-zinc-400">
            ❌ User not found. Check the username and try again.
          </p>
        `;
			}

			return;
		}

		if (results) {
			results.innerHTML = `
        <div class="grid gap-3">
          ${state.searchResults
						.map((user) => userCard(user, state.user?.id === user.id))
						.join("")}
        </div>
      `;
		}

		refreshIcons();
	} catch (error) {
		console.error(error);

		state.searchResults = [];

		if (results) {
			results.innerHTML = "";
		}

		if (message) {
			let text =
				error instanceof AniListError && error.status === 429
					? "⏳ AniList rate limit reached. Please wait a moment and try again."
					: error?.status === 429
					? "⏳ Rate limit reached. Please wait a moment and try again."
					: "⚠️ The selected service is temporarily unavailable. Please try again.";

			message.innerHTML = `
        <p class="rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          ${esc(text)}
        </p>
      `;
		}
	} finally {
		state.searching = false;

		if (searchButton) {
			searchButton.disabled = false;
		}

		if (searchIcon) {
			searchIcon.innerHTML = `
        <i
          data-lucide="search"
          class="size-4"
        ></i>
      `;

			refreshIcons();
		}
	}
}

/* =========================================================
   SELECT USER
========================================================= */

async function selectUser(userId) {
	const u = state.searchResults.find(
		(user) => String(user.id) === String(userId)
	);

	if (!u) return;

	state.user = u;

	state.result = null;
	state.allEntries = [];

	const resultArea = $("#result-area");

	if (resultArea) {
		resultArea.innerHTML = "";
	}

	const userResults = $("#user-results");

	if (userResults) {
		userResults.innerHTML = `
      <div class="grid gap-3">
        ${state.searchResults
					.map((user) =>
						userCard(user, String(state.user.id) === String(user.id))
					)
					.join("")}
      </div>
    `;
	}

	refreshIcons();

	await loadLists();
}

/* =========================================================
   LOAD USER LIST
========================================================= */

async function loadLists() {
	if (!state.user) return;

	state.loading = true;
	state.allEntries = [];
	state.result = null;

	const resultArea = $("#result-area");

	if (resultArea) {
		resultArea.innerHTML = loadingResult();
	}

	const generateButton = $("#generate-btn");
	const generateText = $("#generate-text");
	const poolMessage = $("#pool-message");

	if (generateButton) {
		generateButton.disabled = true;
	}

	if (generateText) {
		generateText.textContent = "Loading List";
	}

	if (poolMessage) {
		poolMessage.textContent = `Loading list from ${
			Providers[state.provider]?.label ?? state.provider
		}…`;
	}

	const types =
		state.filters.media === "BOTH" ? ["ANIME", "MANGA"] : [state.filters.media];

	try {
		const lists = await Promise.all(
			types.map(async (type) => {
				/*
          IMPORTANT:

          The provider receives the USER OBJECT.

          providers.js handles:
          AniList -> user.id
          MAL     -> user object
          Kitsu   -> user object
        */

				const key = `${state.provider}:${state.user.id}:${type}`;

				if (state.cache.has(key)) {
					return state.cache.get(key);
				}

				const data = await Providers[state.provider].fetchMediaList(
					state.user,
					type,
					(page, more, count) => {
						if (poolMessage) {
							poolMessage.textContent = `Loading ${type.toLowerCase()}… ${count} entries`;
						}
					}
				);

				state.cache.set(key, data);

				return data;
			})
		);

		state.allEntries = lists.flat();

		renderPoolState();
		refreshIcons();

		if (resultArea) {
			resultArea.innerHTML = "";
		}
	} catch (error) {
		console.error(error);

		if (resultArea) {
			const message =
				error?.status === 429
					? "⏳ Rate limit reached. Please wait a moment and try again."
					: `⚠️ ${
							error?.message ??
							"The service is temporarily unavailable. Please try again."
					  }`;

			resultArea.innerHTML = `
        <p class="rounded-3xl glass px-5 py-6 text-center text-sm">
          ${esc(message)}
        </p>
      `;
		}

		if (poolMessage) {
			poolMessage.textContent = `${
				Providers[state.provider]?.label ?? state.provider
			} is temporarily unavailable. Please try again.`;
		}
	} finally {
		state.loading = false;

		if (generateText) {
			generateText.textContent = "Generate Random";
		}

		renderPoolState();
	}
}

/* =========================================================
   LOADING CARD
========================================================= */

function loadingResult() {
	return `
    <div class="grid gap-6 rounded-3xl glass p-6 sm:grid-cols-[220px_1fr]">

      <div class="skeleton aspect-[2/3] w-full"></div>

      <div class="space-y-3">

        <div class="skeleton h-7 w-3/4"></div>
        <div class="skeleton h-4 w-1/2"></div>
        <div class="skeleton h-4 w-2/3"></div>
        <div class="skeleton h-20 w-full"></div>

      </div>

    </div>
  `;
}

/* =========================================================
   FILTERED POOL
========================================================= */

function pool() {
	return applyFilters(state.allEntries, state.filters);
}

/* =========================================================
   POOL STATE
========================================================= */

function renderPoolState() {
	const poolMessage = $("#pool-message");
	const generateButton = $("#generate-btn");
	const cacheMessage = $("#cache-message");

	const filtered = pool();

	if (generateButton) {
		generateButton.disabled =
			(state.mode === "user" && !state.user) ||
			state.loading ||
			state.spinning ||
			(state.mode === "user" && filtered.length === 0);
	}

	if (poolMessage) {
		if (state.mode === "random") {
			const preset = getSurprisePreset();

			poolMessage.textContent = `AniList random pick: ${preset.label}`;
		} else if (!state.user) {
			poolMessage.textContent = `Search and select a ${
				Providers[state.provider]?.label ?? state.provider
			} user to begin.`;
		} else if (state.loading) {
			poolMessage.textContent = `Loading list from ${
				Providers[state.provider]?.label ?? state.provider
			}…`;
		} else {
			poolMessage.textContent = `🎯 ${filtered.length} title${
				filtered.length === 1 ? "" : "s"
			} match your filters`;
		}
	}

	if (cacheMessage) {
		cacheMessage.textContent =
			state.mode === "random"
				? "Uses AniList discovery. No user list needed."
				: state.user && !state.loading
				? `${state.allEntries.length} entries fetched and cached for ${state.user.name}`
				: "";
	}
}

/* =========================================================
   TEXT
========================================================= */

function stripHtml(text) {
	if (!text) {
		return "";
	}

	return text
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/* =========================================================
   RESULT CARD
========================================================= */

function resultCard(entry) {
	const media = entry.media;

	const isAnime = media.type === "ANIME";

	const score = media.averageScore ?? media.meanScore ?? null;

	const year = media.seasonYear ?? media.startDate?.year ?? null;

	const cover = media.coverImage?.extraLarge ?? media.coverImage?.large ?? "";

	const title =
		media.title?.english ??
		media.title?.romaji ??
		media.title?.native ??
		"Untitled";

	const subtitle =
		media.title?.english && media.title?.romaji !== media.title?.english
			? media.title?.romaji
			: media.title?.native;

	const facts = [
		score !== null ? `⭐ ${(score / 10).toFixed(1)}` : null,

		`${isAnime ? "🎬" : "📚"} ${countryFlavour(
			media.format,
			media.countryOfOrigin
		)}`,

		isAnime
			? media.episodes
				? `📺 ${media.episodes} Episodes`
				: null
			: media.chapters
			? `📖 ${media.chapters} Chapters`
			: null,

		!isAnime && media.volumes ? `📕 ${media.volumes} Volumes` : null,

		year ? `📅 ${year}` : null,
	].filter(Boolean);

	const providerLabel =
		state.mode === "random"
			? "AniList Random Pick"
			: Providers[state.provider]?.label ?? "Source";

	return `
    <article
      class="result-card overflow-hidden rounded-3xl glass"
      aria-live="polite"
    >

      <div class="grid gap-6 p-5 sm:grid-cols-[220px_1fr] sm:p-6">

        <div class="relative mx-auto w-full max-w-[220px]">

          ${
						cover
							? `
                <img
                  src="${esc(cover)}"
                  alt="${esc(title)} cover art"
                  class="aspect-[2/3] w-full rounded-2xl object-cover shadow-glow"
                >
              `
							: `
                <div class="grid aspect-[2/3] w-full place-items-center rounded-2xl bg-white/5 text-sm text-slate-500">
                  No cover
                </div>
              `
					}

        </div>


        <div class="min-w-0 space-y-4">

          <div>

            <div class="mb-2 text-xs uppercase tracking-widest text-zinc-600">
              ${esc(providerLabel)}
            </div>

            <h3 class="text-2xl font-bold leading-tight text-white sm:text-3xl">
              ${esc(title)}
            </h3>

            ${
							subtitle
								? `
                  <p class="mt-1 text-sm text-slate-400">
                    ${esc(subtitle)}
                  </p>
                `
								: ""
						}

          </div>


          <div class="flex flex-wrap gap-2">

            ${facts
							.map(
								(fact) => `
                  <span class="rounded-full border border-white/10 bg-white/[.04] px-3 py-1 text-xs font-medium text-white">
                    ${fact}
                  </span>
                `
							)
							.join("")}

          </div>


          ${
						media.genres?.length
							? `
                <p class="text-sm text-emerald-200">
                  ${media.genres.map((genre) => esc(genre)).join(" • ")}
                </p>
              `
							: ""
					}


          ${
						state.mode === "user"
							? `
                <p class="text-xs text-slate-400">

                  Your list status:

                  <span class="font-semibold text-white">
                    ${entryStatusLabel(entry.status, media.type)}
                  </span>

                  ${
										entry.score
											? ` • your score ${(entry.score / 10).toFixed(1)}`
											: ""
									}

                </p>
              `
							: ""
					}


          ${
						media.description
							? `
                <p class="line-clamp-5 text-sm leading-relaxed text-slate-400">
                  ${esc(stripHtml(media.description))}
                </p>
              `
							: ""
					}


          <div class="flex flex-wrap gap-3 pt-1">

            <button
              data-result-action="again"
              class="inline-flex items-center gap-2 rounded-2xl gradient-hero px-5 py-3 text-sm font-semibold text-slate-950"
            >
              <i data-lucide="rotate-cw" class="size-4"></i>
              Pick Again
            </button>


            <a
              href="${esc(media.siteUrl ?? "#")}"
              target="_blank"
              rel="noreferrer"
              class="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[.04] px-5 py-3 text-sm font-semibold text-white hover:bg-white/[.08]"
            >
              <i data-lucide="external-link" class="size-4"></i>
              View Source
            </a>


            <button
              data-result-action="share"
              class="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[.04] px-5 py-3 text-sm font-semibold text-white hover:bg-white/[.08]"
            >
              <i data-lucide="share-2" class="size-4"></i>
              Share
            </button>

          </div>


          ${
						pool().length === 1
							? `
                <p class="text-xs text-slate-500">
                  Only one item matches your filters.
                </p>
              `
							: ""
					}

        </div>

      </div>

    </article>
  `;
}

/* =========================================================
   SHARE
========================================================= */

async function shareResult() {
	if (!state.result) {
		return;
	}

	const media = state.result.media;

	const title =
		media.title?.english ??
		media.title?.romaji ??
		media.title?.native ??
		"Untitled";

	const url = media.siteUrl ?? window.location.href;

	const providerLabel =
		state.mode === "random"
			? "AniList Random Pick"
			: Providers[state.provider]?.label ?? "anime list";

	const data = {
		title,
		text: `Random pick from ${providerLabel}: ${title}`,
		url,
	};

	if (navigator.share) {
		try {
			await navigator.share(data);
			return;
		} catch {
			// User cancelled share.
		}
	}

	if (navigator.clipboard) {
		await navigator.clipboard.writeText(`${title} — ${url}`);

		alert("Link copied!");
	}
}

/* =========================================================
   RANDOM PICK
========================================================= */

async function rollSurprise(avoidId) {
	state.timers.forEach(clearTimeout);
	state.timers = [];

	state.loading = true;
	state.spinning = false;
	state.result = null;

	const resultArea = $("#result-area");
	const generateButton = $("#generate-btn");
	const generateText = $("#generate-text");

	if (resultArea) {
		resultArea.innerHTML = loadingResult();
	}

	if (generateButton) {
		generateButton.disabled = true;
	}

	if (generateText) {
		generateText.textContent = "Searching AniList";
	}

	renderPoolState();

	try {
		const winner = await generateSurprisePick(state.filters, avoidId);

		if (!winner) {
			if (resultArea) {
				resultArea.innerHTML = `
          <p class="rounded-3xl glass px-5 py-6 text-center text-sm">
            No AniList titles matched this preset and your filters. Try a broader media/filter choice.
          </p>
        `;
			}

			return;
		}

		state.result = winner;

		addSurpriseHistoryEntry(winner, getSurprisePreset().label);

		if (resultArea) {
			resultArea.innerHTML = resultCard(winner);
		}

		refreshIcons();
	} catch (error) {
		console.error(error);

		if (resultArea) {
			const message =
				error instanceof AniListError && error.status === 429
					? "AniList rate limit reached. Please wait a moment and try again."
					: error?.message ??
					  "AniList is temporarily unavailable. Please try again.";

			resultArea.innerHTML = `
        <p class="rounded-3xl glass px-5 py-6 text-center text-sm">
          ${esc(message)}
        </p>
      `;
		}
	} finally {
		state.loading = false;

		if (generateText) {
			generateText.textContent = "Generate Random";
		}

		renderPoolState();
		refreshIcons();
	}
}

function roll(avoidId) {
	if (state.mode === "random") {
		rollSurprise(avoidId);
		return;
	}

	state.timers.forEach(clearTimeout);
	state.timers = [];

	const available = pool();

	if (!available.length) {
		state.result = null;

		const resultArea = $("#result-area");

		if (resultArea) {
			resultArea.innerHTML = `
        <p class="rounded-3xl glass px-5 py-6 text-center text-sm">

          ${
						state.allEntries.length === 0
							? "📭 This user has no entries matching the selected list."
							: "😅 No anime/manga found with these filters. Try changing your filters."
					}

        </p>
      `;
		}

		return;
	}

	const winner = pickRandom(available, avoidId);

	if (!winner) {
		return;
	}

	if (available.length === 1) {
		state.result = winner;

		const resultArea = $("#result-area");

		if (resultArea) {
			resultArea.innerHTML = resultCard(winner);
		}

		refreshIcons();

		return;
	}

	state.spinning = true;

	renderPoolState();

	const reel = shuffleSample(available, 8);

	reel.forEach((entry, index) => {
		state.timers.push(
			setTimeout(() => {
				state.reel = entry;

				const resultArea = $("#result-area");

				if (!resultArea) {
					return;
				}

				const image =
					entry.media.coverImage?.large ??
					entry.media.coverImage?.extraLarge ??
					"";

				const title =
					entry.media.title?.english ??
					entry.media.title?.romaji ??
					entry.media.title?.native ??
					"";

				resultArea.innerHTML = `
              <div class="result-card rounded-3xl glass p-6 text-center">

                <div class="mx-auto aspect-[2/3] w-32 overflow-hidden rounded-2xl">

                  ${
										image
											? `
                        <img
                          src="${esc(image)}"
                          class="size-full object-cover"
                          alt=""
                        >
                      `
											: ""
									}

                </div>

                <p class="mt-4 truncate text-sm font-semibold text-white">
                  ${esc(title)}
                </p>

                <p class="mt-1 text-xs text-slate-400">
                  Randomizing…
                </p>

              </div>
            `;
			}, index * 130)
		);
	});

	state.timers.push(
		setTimeout(() => {
			state.spinning = false;
			state.reel = null;
			state.result = winner;

			const resultArea = $("#result-area");

			if (resultArea) {
				resultArea.innerHTML = resultCard(winner);
			}

			renderPoolState();
			refreshIcons();
		}, reel.length * 130 + 180)
	);
}

/* =========================================================
   CLICK EVENTS
========================================================= */

document.addEventListener("click", (event) => {
	const target = event.target.closest("[data-action]");

	/* =========================
       NORMAL CHIPS
    ========================= */

	if (target) {
		const [key, value] = target.dataset.action.split(":");

		if (key === "media" || key === "status") {
			state.filters[key] = value;

			/*
          Changing media should clear
          incompatible filters.
        */

			if (key === "media") {
				if (value === "ANIME") {
					state.filters.mangaFormats = [];
					state.filters.countries = [];
					state.filters.minChapters = "";
					state.filters.maxChapters = "";
					state.filters.minVolumes = "";
				}

				if (value === "MANGA") {
					state.filters.animeFormats = [];
					state.filters.minEpisodes = "";
					state.filters.maxEpisodes = "";
				}
			}

			state.result = null;

			const resultArea = $("#result-area");

			if (resultArea) {
				resultArea.innerHTML = "";
			}

			renderFilters();
			renderPoolState();
			refreshIcons();

			/*
          Reload the selected user's list
          when the media type changes.
        */

			if (
				state.mode === "user" &&
				state.user &&
				["ANIME", "MANGA", "BOTH"].includes(value)
			) {
				loadLists();
			}

			return;
		}
	}

	/* =========================
       SOURCE TABS
    ========================= */

	const sourceTab = event.target.closest("[data-source-tab]");

	if (sourceTab) {
		setMode(sourceTab.dataset.sourceTab);

		return;
	}

	/* =========================
       CHECKBOX CHIPS
    ========================= */

	const check = event.target.closest("[data-check]");

	if (check) {
		const key = check.dataset.check;

		const value = check.dataset.value;

		if (
			[
				"excludeMovies",
				"excludeShorts",
				"excludeSpecials",
				"excludeMusic",
				"excludeOneShots",
				"excludeNovels",
				"excludeNoScore",
				"excludeNoCover",
			].includes(key)
		) {
			state.filters[key] = !state.filters[key];
		} else {
			const current = state.filters[key];

			state.filters[key] = current.includes(value)
				? current.filter((item) => item !== value)
				: [...current, value];
		}

		renderAdvanced();
		renderPoolState();
		refreshIcons();

		return;
	}

	/* =========================
       USER CARD
    ========================= */

	const user = event.target.closest("[data-user]");

	if (user) {
		selectUser(user.dataset.user);

		return;
	}

	/* =========================
       RESULT BUTTONS
    ========================= */

	const resultAction = event.target.closest("[data-result-action]");

	if (resultAction) {
		const action = resultAction.dataset.resultAction;

		if (action === "again") {
			roll(state.result?.media?.id);
		} else if (action === "share") {
			shareResult();
		}

		return;
	}

	/* =========================
       ADVANCED FILTER
    ========================= */

	const advanced = event.target.closest("#advanced-toggle");

	if (advanced) {
		state.filtersOpen = !state.filtersOpen;

		const panel = $("#advanced-filters");

		if (panel) {
			panel.classList.toggle("hidden", !state.filtersOpen);
		}

		advanced.setAttribute("aria-expanded", String(state.filtersOpen));

		const chevron = $("#chevron");

		if (chevron) {
			chevron.style.transform = state.filtersOpen ? "rotate(180deg)" : "";
		}

		refreshIcons();

		return;
	}

	/* =========================
       GENERATE
    ========================= */

	if (event.target.closest("#generate-btn")) {
		if (!state.loading && !state.spinning) {
			roll();
		}

		return;
	}
});

/* =========================================================
   INPUT EVENTS
========================================================= */

document.addEventListener("input", (event) => {
	const field = event.target.dataset.field;

	if (field) {
		state.filters[field] = event.target.value;

		renderPoolState();
	}

	if (event.target.id === "score-range") {
		state.filters.minScore = Number(event.target.value);

		renderAdvanced();
		renderPoolState();
		refreshIcons();
	}
});

/* =========================================================
   SOURCE MODE
========================================================= */

function setMode(mode) {
	state.mode = mode === "random" ? "random" : "user";

	state.result = null;
	state.spinning = false;
	state.loading = false;
	state.timers.forEach(clearTimeout);
	state.timers = [];

	const userPanel = $("#user-search-panel");

	const randomPanel = $("#random-pick-panel");

	const resultArea = $("#result-area");

	document.querySelectorAll("[data-source-tab]").forEach((tab) => {
		const active = tab.dataset.sourceTab === state.mode;

		tab.classList.toggle("active", active);

		tab.setAttribute("aria-selected", String(active));
	});

	if (userPanel) {
		userPanel.classList.toggle("hidden", state.mode !== "user");
	}

	if (randomPanel) {
		randomPanel.classList.toggle("hidden", state.mode !== "random");
	}

	setSurpriseHistoryMode(state.mode);

	if (resultArea) {
		resultArea.innerHTML = "";
	}

	renderFilters();
	renderPoolState();
	refreshIcons();
}

/* =========================================================
   PROVIDER CHANGE
========================================================= */

function setupProviderListener() {
	const providerSelect = $("#provider-select");

	if (!providerSelect) {
		console.warn("provider-select element not found.");

		return;
	}

	providerSelect.addEventListener("change", async (event) => {
		state.provider = event.target.value;

		if (!Providers[state.provider]) {
			state.provider = "anilist";

			providerSelect.value = "anilist";
		}

		state.user = null;
		state.searchResults = [];
		state.allEntries = [];
		state.result = null;
		state.loading = false;
		state.spinning = false;

		const userResults = $("#user-results");

		const resultArea = $("#result-area");

		if (userResults) {
			userResults.innerHTML = "";
		}

		if (resultArea) {
			resultArea.innerHTML = "";
		}

		updateProviderNote();
		renderFilters();
		renderPoolState();
		refreshIcons();
	});
}

/* =========================================================
   SEARCH FORM
========================================================= */

function setupSearchListener() {
	const form = $("#user-search-form");

	if (!form) {
		console.warn("user-search-form element not found.");

		return;
	}

	form.addEventListener("submit", (event) => {
		event.preventDefault();

		search();
	});
}

/* =========================================================
   INITIALIZE APP
========================================================= */

function initializeApp() {
	renderProvider();

	updateProviderNote();

	renderFilters();

	renderPoolState();

	refreshIcons();

	setupProviderListener();

	setupSearchListener();

	initSurpriseUI({
		onChange: () => {
			state.result = null;

			const resultArea = $("#result-area");

			if (resultArea) {
				resultArea.innerHTML = "";
			}

			renderPoolState();
		},

		refreshIcons,
	});

	initSurpriseHistoryUI({
		mode: state.mode,

		onShow: (entry) => {
			setMode("random");

			state.result = entry;
			state.loading = false;
			state.spinning = false;

			const resultArea = $("#result-area");

			if (resultArea) {
				resultArea.innerHTML = resultCard(entry);
			}

			renderPoolState();
			refreshIcons();
		},

		refreshIcons,
	});
}

/*
  Because this is a module, it normally executes
  after HTML parsing. This check also makes the
  application safe if the script is moved later.
*/

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initializeApp, { once: true });
} else {
	initializeApp();
}
