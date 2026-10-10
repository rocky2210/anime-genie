import { gql } from "./anilist.js";

const MEDIA_FIELDS = `
  id type format status episodes chapters volumes duration averageScore meanScore
  countryOfOrigin genres description(asHtml: false) siteUrl season seasonYear
  startDate { year } bannerImage coverImage { extraLarge large color }
  title { romaji english native }
`;

const DISCOVER_MEDIA = `
  query DiscoverMedia(
	$page: Int!
	$perPage: Int!
	$type: MediaType!
	$sort: [MediaSort]
	$format_in: [MediaFormat]
	$genre_in: [String]
	$countryOfOrigin: CountryCode
	$averageScore_greater: Int
	$averageScore_lesser: Int
	$startDate_greater: FuzzyDateInt
	$startDate_lesser: FuzzyDateInt
	$episodes_greater: Int
	$episodes_lesser: Int
	$chapters_greater: Int
	$chapters_lesser: Int
	$volumes_greater: Int
	$volumes_lesser: Int
	$popularity_lesser: Int
	$status: MediaStatus
  ) {
	Page(page: $page, perPage: $perPage) {
	  pageInfo { lastPage hasNextPage }
	  media(
		type: $type
		sort: $sort
		format_in: $format_in
		genre_in: $genre_in
		countryOfOrigin: $countryOfOrigin
		averageScore_greater: $averageScore_greater
		averageScore_lesser: $averageScore_lesser
		startDate_greater: $startDate_greater
		startDate_lesser: $startDate_lesser
		episodes_greater: $episodes_greater
		episodes_lesser: $episodes_lesser
		chapters_greater: $chapters_greater
		chapters_lesser: $chapters_lesser
		volumes_greater: $volumes_greater
		volumes_lesser: $volumes_lesser
		popularity_lesser: $popularity_lesser
		status: $status
		isAdult: false
	  ) {
		${MEDIA_FIELDS}
	  }
	}
  }
`;

export const SURPRISE_PRESETS = [
	{
		id: "surprise",
		icon: "dices",
		label: "Surprise Me",
		description: "Results will be a random anime or manga.",
		sort: ["POPULARITY_DESC"],
	},
	{
		id: "hidden-gems",
		icon: "gem",
		label: "Hidden Gems",
		description: "Low popularity, strong score.",
		sort: ["SCORE_DESC"],
		minScore: 75,
		maxPopularity: 50000,
	},
	{
		id: "quick-watch",
		icon: "zap",
		label: "Quick Watch",
		description: "Anime that can be watched in an afternoon.",
		animeOnly: true,
		status: "FINISHED",
		maxHours: 6,
		sort: ["SCORE_DESC"],
	},
	{
		id: "nineties",
		icon: "cassette-tape",
		label: "90s Classics",
		description: "Highly rated releases from the 1990s.",
		yearFrom: 1990,
		yearTo: 1999,
		status: "FINISHED",
		minScore: 75,
		sort: ["SCORE_DESC"],
	},
	{
		id: "two-thousands",
		icon: "disc-3",
		label: "2000s Classics",
		description: "Highly rated releases from the 2000s.",
		yearFrom: 2000,
		yearTo: 2009,
		status: "FINISHED",
		minScore: 75,
		sort: ["SCORE_DESC"],
	},
	{
		id: "poorly-rated",
		icon: "thumbs-down",
		label: "Poorly Rated",
		description: "Results with weaker audience scores.",
		maxScore: 50,
		sort: ["SCORE"],
	},
	{
		id: "highly-rated",
		icon: "trophy",
		label: "Highly Rated",
		description: "Results with strong audience scores.",
		minScore: 75,
		sort: ["SCORE_DESC"],
	},
	{
		id: "weekend-watch",
		icon: "calendar-days",
		label: "Weekend Watch",
		description: "Finished anime that can fit into a weekend.",
		animeOnly: true,
		status: "FINISHED",
		minHours: 6,
		maxHours: 20,
		sort: ["SCORE_DESC"],
	},
	{
		id: "long-journey",
		icon: "route",
		label: "Long Journey",
		description: "Finished anime with a larger time commitment.",
		animeOnly: true,
		status: "FINISHED",
		minHours: 20,
		sort: ["POPULARITY_DESC"],
	},
];

let activePresetId = "surprise";

const esc = (value) =>
	String(value ?? "").replace(
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

const toNumber = (value) =>
	String(value ?? "").trim() === "" || Number.isNaN(Number(value))
		? null
		: Number(value);

const randomItem = (items) =>
	items[Math.floor(Math.random() * items.length)] ?? null;

function activePreset() {
	return (
		SURPRISE_PRESETS.find((preset) => preset.id === activePresetId) ??
		SURPRISE_PRESETS[0]
	);
}

function presetFacts(preset) {
	const facts = [];

	if (preset.status) {
		facts.push(["Airing Status", "Aired"]);
	}

	if (preset.yearFrom) {
		facts.push(["From Date", `01/01/${preset.yearFrom}`]);
	}

	if (preset.yearTo) {
		facts.push(["To Date", `31/12/${preset.yearTo}`]);
	}

	if (preset.minHours || preset.maxHours) {
		const min = preset.minHours ?? 0;
		const max = preset.maxHours ? `${preset.maxHours}` : "20+";
		facts.push(["Total Duration", `${min}-${max} hours`]);
	}

	if (preset.minScore || preset.maxScore) {
		facts.push(["Score", `${preset.minScore ?? 0}-${preset.maxScore ?? 100}%`]);
	}

	return facts;
}

function renderPresetNote() {
	const note = document.querySelector("#surprise-preset-note");

	if (!note) return;

	const preset = activePreset();

	const facts = presetFacts(preset);

	note.innerHTML = `
	<p>${esc(preset.description)}</p>
	${
			facts.length
				? `
		  <dl>
			${facts
							.map(
								([label, value]) => `
				  <div>
					<dt>${esc(label)}:</dt>
					<dd>${esc(value)}</dd>
				  </div>
				`
							)
							.join("")}
		  </dl>
		`
				: ""
		}
  `;
}

function renderPresets() {
	const root = document.querySelector("#surprise-presets");

	if (!root) return;

	root.innerHTML = SURPRISE_PRESETS.map(
		(preset) => `
		<button
		  type="button"
		  class="surprise-preset ${
						preset.id === activePresetId ? "active" : ""
					}"
		  data-surprise-preset="${esc(preset.id)}"
		  title="${esc(preset.description)}"
		>
		  <i data-lucide="${esc(preset.icon)}" class="size-4"></i>
		  <span>${esc(preset.label)}</span>
		</button>
	  `
	).join("");

	renderPresetNote();
}

export async function initSurpriseUI({ onChange, refreshIcons } = {}) {
	if (typeof document === "undefined") {
		return;
	}

	const root = document.querySelector("#surprise-random-root");

	if (!root) return;

	try {
		const res = await fetch("./components/surprise-random.html");

		if (!res.ok) {
			throw new Error("Fragment unavailable");
		}

		root.innerHTML = await res.text();
	} catch {
		root.innerHTML = `
	  <div class="space-y-4">
		<div>
		  <h2 class="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
			Random Pick
		  </h2>
		  <p class="mt-2 text-xs leading-relaxed text-zinc-600">
			Uses AniList discovery with the selected media type and preset below.
		  </p>
		</div>
		<div id="surprise-presets" class="surprise-presets"></div>
		<div id="surprise-preset-note" class="surprise-note"></div>
	  </div>
	`;
	}

	renderPresets();
	refreshIcons?.();

	root.addEventListener("click", (event) => {
		const button = event.target.closest("[data-surprise-preset]");

		if (!button) return;

		activePresetId = button.dataset.surprisePreset;

		renderPresets();
		refreshIcons?.();
		onChange?.(activePreset());
	});
}

export function getSurprisePreset() {
	return activePreset();
}

export function setSurprisePreset(id) {
	if (SURPRISE_PRESETS.some((preset) => preset.id === id)) {
		activePresetId = id;
	}

	if (typeof document !== "undefined") {
		renderPresets();
	}

	return activePreset();
}

function buildVariables(filters, preset, type, page) {
	const minScore = Math.max(filters.minScore || 0, preset.minScore || 0);

	const maxScore = preset.maxScore || null;

	const yearFrom = preset.yearFrom ?? toNumber(filters.yearFrom);

	const yearTo = preset.yearTo ?? toNumber(filters.yearTo);

	const variables = {
		page,
		perPage: 35,
		type,
		sort: preset.sort || ["POPULARITY_DESC"],
	};

	if (minScore > 0) {
		variables.averageScore_greater = minScore - 1;
	}

	if (maxScore !== null) {
		variables.averageScore_lesser = maxScore + 1;
	}

	if (yearFrom !== null) {
		variables.startDate_greater = (yearFrom - 1) * 10000 + 1231;
	}

	if (yearTo !== null) {
		variables.startDate_lesser = (yearTo + 1) * 10000 + 101;
	}

	if (preset.status) {
		variables.status = preset.status;
	}

	if (preset.maxPopularity) {
		variables.popularity_lesser = preset.maxPopularity;
	}

	if (filters.genres.length) {
		variables.genre_in = filters.genres;
	}

	if (type === "ANIME") {
		if (filters.animeFormats.length) {
			variables.format_in = filters.animeFormats;
		}

		const minEpisodes = toNumber(filters.minEpisodes);

		const maxEpisodes = toNumber(filters.maxEpisodes);

		if (minEpisodes !== null) {
			variables.episodes_greater = minEpisodes - 1;
		}

		if (maxEpisodes !== null) {
			variables.episodes_lesser = maxEpisodes + 1;
		}
	} else {
		if (filters.mangaFormats.length) {
			variables.format_in = filters.mangaFormats;
		}

		if (filters.countries.length === 1) {
			variables.countryOfOrigin = filters.countries[0];
		}

		const minChapters = toNumber(filters.minChapters);

		const maxChapters = toNumber(filters.maxChapters);

		const minVolumes = toNumber(filters.minVolumes);

		if (minChapters !== null) {
			variables.chapters_greater = minChapters - 1;
		}

		if (maxChapters !== null) {
			variables.chapters_lesser = maxChapters + 1;
		}

		if (minVolumes !== null) {
			variables.volumes_greater = minVolumes - 1;
		}
	}

	return variables;
}

function totalHours(media) {
	if (media.type !== "ANIME" || !media.episodes || !media.duration) {
		return null;
	}

	return (media.episodes * media.duration) / 60;
}

function matchesClientFilters(media, filters, preset) {
	const score = media.averageScore ?? media.meanScore ?? null;

	if (filters.excludeNoScore && score === null) {
		return false;
	}

	if (
		filters.excludeNoCover &&
		!(media.coverImage?.extraLarge || media.coverImage?.large)
	) {
		return false;
	}

	if (filters.excludeMovies && media.format === "MOVIE") {
		return false;
	}

	if (filters.excludeSpecials && media.format === "SPECIAL") {
		return false;
	}

	if (filters.excludeMusic && media.format === "MUSIC") {
		return false;
	}

	if (
		filters.excludeShorts &&
		media.type === "ANIME" &&
		media.episodes !== null &&
		media.episodes < (toNumber(filters.shortEpisodeLimit) ?? 6)
	) {
		return false;
	}

	if (filters.excludeOneShots && media.format === "ONE_SHOT") {
		return false;
	}

	if (
		filters.excludeNovels &&
		["NOVEL", "LIGHT_NOVEL"].includes(media.format)
	) {
		return false;
	}

	if (filters.countries.length > 1) {
		if (
			!media.countryOfOrigin ||
			!filters.countries.includes(media.countryOfOrigin)
		) {
			return false;
		}
	}

	const hours = totalHours(media);

	if (
		preset.minHours !== undefined &&
		(hours === null || hours < preset.minHours)
	) {
		return false;
	}

	if (
		preset.maxHours !== undefined &&
		(hours === null || hours > preset.maxHours)
	) {
		return false;
	}

	return true;
}

function mediaToEntry(media) {
	return {
		id: `surprise-${media.id}`,

		status: "PLANNING",

		score: 0,

		progress: 0,

		media,
	};
}

export async function generateSurprisePick(filters, avoidId) {
	const preset = activePreset();

	const type = preset.animeOnly
		? "ANIME"
		: filters.media === "BOTH"
		? randomItem(["ANIME", "MANGA"])
		: filters.media;

	const firstPageVariables = buildVariables(filters, preset, type, 1);

	const first = await gql(DISCOVER_MEDIA, firstPageVariables);

	const lastPage = Math.min(first.Page?.pageInfo?.lastPage || 1, 20);

	const page = Math.max(1, Math.floor(Math.random() * lastPage) + 1);

	const data =
		page === 1
			? first
			: await gql(DISCOVER_MEDIA, buildVariables(filters, preset, type, page));

	let candidates = (data.Page?.media || [])
		.filter(Boolean)
		.filter((media) => matchesClientFilters(media, filters, preset));

	if (!candidates.length && page !== 1) {
		candidates = (first.Page?.media || [])
			.filter(Boolean)
			.filter((media) => matchesClientFilters(media, filters, preset));
	}

	for (
		let fallbackPage = 2;
		!candidates.length && fallbackPage <= Math.min(lastPage, 5);
		fallbackPage++
	) {
		const fallback = await gql(
			DISCOVER_MEDIA,
			buildVariables(filters, preset, type, fallbackPage)
		);

		candidates = (fallback.Page?.media || [])
			.filter(Boolean)
			.filter((media) => matchesClientFilters(media, filters, preset));
	}

	if (avoidId && candidates.length > 1) {
		candidates = candidates.filter(
			(media) => String(media.id) !== String(avoidId)
		);
	}

	const media = randomItem(candidates);

	return media ? mediaToEntry(media) : null;
}
