export const STATUS_OPTIONS = [
	{ value: "ALL", icon: "✨" },
	{ value: "CURRENT", icon: "👀" },
	{ value: "COMPLETED", icon: "✅" },
	{ value: "PLANNING", icon: "📋" },
	{ value: "PAUSED", icon: "⏸️" },
	{ value: "DROPPED", icon: "❌" },
];
export const ANIME_FORMATS = [
	["TV", "TV"],
	["TV_SHORT", "TV Short"],
	["MOVIE", "Movie"],
	["OVA", "OVA"],
	["ONA", "ONA"],
	["SPECIAL", "Special"],
	["MUSIC", "Music"],
];
export const MANGA_FORMATS = [
	["MANGA", "Manga"],
	["NOVEL", "Novel"],
	["ONE_SHOT", "One Shot"],
];
export const COUNTRIES = [
	["JP", "Manga (JP)"],
	["KR", "Manhwa (KR)"],
	["CN", "Manhua (CN)"],
	["TW", "Manhua (TW)"],
];
export const GENRES = [
	"Action",
	"Adventure",
	"Comedy",
	"Drama",
	"Ecchi",
	"Fantasy",
	"Horror",
	"Mahou Shoujo",
	"Mecha",
	"Music",
	"Mystery",
	"Psychological",
	"Romance",
	"Sci-Fi",
	"Slice of Life",
	"Sports",
	"Supernatural",
	"Thriller",
];

export const defaultFilters = () => ({
	media: "ANIME",
	status: "PLANNING",
	animeFormats: [],
	mangaFormats: [],
	genres: [],
	minScore: 0,
	minEpisodes: "",
	maxEpisodes: "",
	minChapters: "",
	maxChapters: "",
	minVolumes: "",
	yearFrom: "",
	yearTo: "",
	countries: [],
	excludeMovies: false,
	excludeShorts: false,
	shortEpisodeLimit: "6",
	excludeSpecials: false,
	excludeMusic: false,
	excludeOneShots: false,
	excludeNovels: false,
	excludeNoScore: false,
	excludeNoCover: false,
});

export function statusLabel(status, media) {
	if (status === "ALL") return "All";
	if (status === "CURRENT")
		return media === "MANGA"
			? "Reading"
			: media === "BOTH"
			? "Watching / Reading"
			: "Watching";
	return status.charAt(0) + status.slice(1).toLowerCase();
}
export function entryStatusLabel(status, type) {
	return status === "CURRENT"
		? type === "MANGA"
			? "Reading"
			: "Watching"
		: status.charAt(0) + status.slice(1).toLowerCase();
}
export function formatLabel(format) {
	return (
		{
			TV: "TV",
			TV_SHORT: "TV Short",
			MOVIE: "Movie",
			SPECIAL: "Special",
			OVA: "OVA",
			ONA: "ONA",
			MUSIC: "Music",
			MANGA: "Manga",
			NOVEL: "Novel",
			ONE_SHOT: "One Shot",
		}[format] ??
		format ??
		"Unknown"
	);
}
export function countryFlavour(format, country) {
	if (format === "MANGA") {
		if (country === "KR") return "Manhwa";
		if (country === "CN" || country === "TW") return "Manhua";
		return "Manga";
	}
	return formatLabel(format);
}
const num = (v) =>
	v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v);

export function applyFilters(entries, f) {
	const minEp = num(f.minEpisodes),
		maxEp = num(f.maxEpisodes),
		minCh = num(f.minChapters),
		maxCh = num(f.maxChapters),
		minVol = num(f.minVolumes),
		yFrom = num(f.yearFrom),
		yTo = num(f.yearTo),
		shortLimit = num(f.shortEpisodeLimit) ?? 6;
	return entries.filter((entry) => {
		const m = entry.media;
		if (f.media !== "BOTH" && m.type !== f.media) return false;
		if (f.status !== "ALL" && entry.status !== f.status) return false;
		const isAnime = m.type === "ANIME",
			formats = isAnime ? f.animeFormats : f.mangaFormats;
		if (formats.length && (!m.format || !formats.includes(m.format)))
			return false;
		if (f.genres.length && !f.genres.some((g) => m.genres?.includes(g)))
			return false;
		const score = m.averageScore ?? m.meanScore ?? null;
		if (f.minScore > 0 && (score === null || score < f.minScore)) return false;
		if (f.excludeNoScore && score === null) return false;
		if (f.excludeNoCover && !(m.coverImage?.extraLarge || m.coverImage?.large))
			return false;
		const year = m.seasonYear ?? m.startDate?.year ?? null;
		if (yFrom !== null && (year === null || year < yFrom)) return false;
		if (yTo !== null && (year === null || year > yTo)) return false;
		if (isAnime) {
			if (minEp !== null && (m.episodes === null || m.episodes < minEp))
				return false;
			if (maxEp !== null && (m.episodes === null || m.episodes > maxEp))
				return false;
			if (f.excludeMovies && m.format === "MOVIE") return false;
			if (f.excludeSpecials && m.format === "SPECIAL") return false;
			if (f.excludeMusic && m.format === "MUSIC") return false;
			if (f.excludeShorts && m.episodes !== null && m.episodes < shortLimit)
				return false;
		} else {
			if (minCh !== null && (m.chapters === null || m.chapters < minCh))
				return false;
			if (maxCh !== null && (m.chapters === null || m.chapters > maxCh))
				return false;
			if (minVol !== null && (m.volumes === null || m.volumes > minVol)) {
			} // overwritten below
			if (minVol !== null && (m.volumes === null || m.volumes < minVol))
				return false;
			if (f.excludeOneShots && m.format === "ONE_SHOT") return false;
			if (
				f.excludeNovels &&
				(m.format === "NOVEL" || m.format === "LIGHT_NOVEL")
			)
				return false;
			if (
				f.countries.length &&
				(!m.countryOfOrigin || !f.countries.includes(m.countryOfOrigin))
			)
				return false;
		}
		return true;
	});
}
export function pickRandom(pool, avoidId) {
	if (!pool.length) return null;
	if (pool.length === 1) return pool[0];
	const candidates = avoidId
		? pool.filter((e) => e.media.id !== avoidId)
		: pool;
	const list = candidates.length ? candidates : pool;
	return list[Math.floor(Math.random() * list.length)] ?? null;
}
export function shuffleSample(pool, count) {
	const out = [];
	for (let i = 0; i < count; i++) {
		const item = pool[Math.floor(Math.random() * pool.length)];
		if (item) out.push(item);
	}
	return out;
}
