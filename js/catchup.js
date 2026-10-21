import { gql } from "./anilist.js";

const USER_QUERY = `
  query CatchUpUser($name: String!) {
    User(name: $name) { id name siteUrl avatar { large } }
  }
`;

const LIST_QUERY = `
  query CatchUpList($userId: Int!, $page: Int!) {
    Page(page: $page, perPage: 25) {
      pageInfo { currentPage hasNextPage }
      mediaList(userId: $userId, type: ANIME, sort: MEDIA_ID) {
        status progress
        media {
          id type format status episodes season seasonYear
          startDate { year month day }
          siteUrl title { english romaji native }
          coverImage { extraLarge large }
          relations {
            edges {
              relationType
              node {
                id type format status episodes season seasonYear
                startDate { year month day }
                siteUrl title { english romaji native }
                coverImage { extraLarge large }
              }
            }
          }
        }
      }
    }
  }
`;

const $ = (selector) => document.querySelector(selector);

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));

const titleOf = (media) =>
  media?.title?.english ||
  media?.title?.romaji ||
  media?.title?.native ||
  "Unknown title";

const coverOf = (media) =>
  media?.coverImage?.extraLarge || media?.coverImage?.large || "";

const yearOf = (media) =>
  media?.seasonYear || media?.startDate?.year || null;

const dateOf = (media) => {
  const d = media?.startDate;

  if (!d?.year) {
    return yearOf(media) ? String(yearOf(media)) : "Release date unknown";
  }

  return [d.year, d.month, d.day]
    .filter((v) => v != null)
    .join("-");
};

const statusLabel = (status) => ({
  FINISHED: "Finished airing",
  RELEASING: "Currently airing",
  NOT_YET_RELEASED: "Upcoming",
  CANCELLED: "Cancelled",
  HIATUS: "On hiatus",
}[status] || "Status unknown");

const formatLabel = (format) =>
  ({ TV_SHORT: "TV Short" }[format] ||
    String(format || "Unknown format").replaceAll("_", " "));

const formatMatches = (media, filter) => {
  if (filter === "ALL") return true;
  if (filter === "TV") return ["TV", "TV_SHORT"].includes(media?.format);
  return media?.format === filter;
};

let requestInProgress = false;
const resultCache = new Map();
let currentReport = null;
let activeSection = "ready";
let activeFormat = "ALL";
let displayMode = "cards";

function setMessage(message = "", type = "info") {
  const target = $("#catchup-message");
  if (!target) return;

  const classes = type === "error"
    ? "border-red-400/30 bg-red-400/10 text-red-300"
    : "border-zinc-800 bg-zinc-950 text-zinc-400";

  target.innerHTML = message ? `<p class="rounded-lg border px-4 py-3 text-sm ${classes}">${esc(message)}</p>` : "";
}

function renderEmpty(title, description) {
  return `<div class="catchup-empty">
    <i data-lucide="check-circle-2" class="mx-auto size-7 text-emerald-300"></i>
    <h3>${esc(title)}</h3>
    <p>${esc(description)}</p>
  </div>`;
}

function card(item, upcoming = false) {
  const media = item.media;
  const cover = coverOf(media);
  const sourceTitle = titleOf(item.source);
  const status = media.status;

  const badgeClass = upcoming
    ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
    : status === "RELEASING"
      ? "border-sky-400/30 bg-sky-400/10 text-sky-200"
      : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";

  return `<article class="catchup-card">
    <a class="catchup-cover" href="${esc(media.siteUrl || "https://anilist.co")}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(titleOf(media))} on AniList">
      ${cover
        ? `<img src="${esc(cover)}" alt="Cover for ${esc(titleOf(media))}" loading="lazy">`
        : `<span class="catchup-no-cover">No cover</span>`}
    </a>
    <div class="catchup-card-body">
      <div class="catchup-card-badges">
        <span class="catchup-status ${badgeClass}">${esc(upcoming ? "Upcoming" : statusLabel(status))}</span>
        ${media.format ? `<span class="catchup-format">${esc(formatLabel(media.format))}</span>` : ""}
      </div>
      <h3 class="catchup-card-title"><a href="${esc(media.siteUrl || "https://anilist.co")}" target="_blank" rel="noopener noreferrer">${esc(titleOf(media))}</a></h3>
      <p class="catchup-card-meta">${esc(yearOf(media) || "Year unknown")}${media.episodes ? ` · ${esc(media.episodes)} episodes` : ""}</p>
      <p class="catchup-source">Sequel to <a href="${esc(item.source.siteUrl || "https://anilist.co")}" target="_blank" rel="noopener noreferrer">${esc(sourceTitle)}</a></p>
      <p class="catchup-card-date">Relation: ${esc(item.relation.replaceAll("_", " ").toLowerCase())} · ${esc(dateOf(media))}</p>
    </div>
  </article>`;
}

function renderControls() {
  const sections = [
    { id: "ready", label: "Ready to catch up", count: currentReport.available.length },
    { id: "upcoming", label: "Upcoming", count: currentReport.upcoming.length },
  ];

  const filters = [
    ["ALL", "All"],
    ["OVA", "OVA"],
    ["ONA", "ONA"],
    ["TV", "TV"],
    ["MOVIE", "Movie"],
    ["SPECIAL", "Special"],
  ];

  return `<div class="catchup-toolbar">
    <div class="catchup-section-tabs" role="tablist" aria-label="Catch-Up sections">
      ${sections.map((tab) => `<button type="button" role="tab" aria-selected="${activeSection === tab.id}" class="catchup-section-tab ${activeSection === tab.id ? "active" : ""}" data-catchup-section="${tab.id}">${tab.label}<span>${tab.count}</span></button>`).join("")}
    </div>
    <div class="catchup-controls-row">
      <div class="catchup-format-filters" role="group" aria-label="Filter by anime format">
        ${filters.map(([value, label]) => `<button type="button" class="catchup-filter ${activeFormat === value ? "active" : ""}" aria-pressed="${activeFormat === value}" data-catchup-format="${value}">${label}</button>`).join("")}
      </div>
      <div class="catchup-view-toggle" role="group" aria-label="Result layout">
        <button type="button" class="catchup-view-button ${displayMode === "cards" ? "active" : ""}" aria-pressed="${displayMode === "cards"}" data-catchup-view="cards"><i data-lucide="layout-grid" class="size-4"></i><span>Cards</span></button>
        <button type="button" class="catchup-view-button ${displayMode === "list" ? "active" : ""}" aria-pressed="${displayMode === "list"}" data-catchup-view="list"><i data-lucide="list" class="size-4"></i><span>List</span></button>
      </div>
    </div>
  </div>`;
}

function renderResultsPanel() {
  const results = $("#catchup-results");
  if (!results || !currentReport) return;

  const sourceItems = activeSection === "ready"
    ? currentReport.available
    : currentReport.upcoming;

  const items = sourceItems.filter((item) =>
    formatMatches(item.media, activeFormat)
  );

  const label = activeSection === "ready"
    ? "Ready to catch up"
    : "Upcoming";

  const description = activeSection === "ready"
    ? "Released or currently airing sequels missing from your AniList list."
    : "Announced sequels that AniList currently marks as not yet released.";

  results.innerHTML = `
    <div class="mb-8 flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-3">
        ${currentReport.user.avatar?.large
          ? `<img src="${esc(currentReport.user.avatar.large)}" alt="" class="size-11 rounded-full border border-zinc-800 object-cover">`
          : `<div class="grid size-11 place-items-center rounded-full bg-zinc-900"><i data-lucide="user-round" class="size-5 text-zinc-400"></i></div>`}
        <div>
          <p class="text-sm font-semibold text-zinc-100">${esc(currentReport.user.name)}'s Catch-Up Report</p>
          <a class="mt-1 inline-block text-xs text-emerald-300 hover:underline" href="${esc(currentReport.user.siteUrl || `https://anilist.co/user/${encodeURIComponent(currentReport.user.name)}`)}" target="_blank" rel="noopener noreferrer">View AniList profile ↗</a>
        </div>
      </div>
      <button id="catchup-refresh" type="button" class="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-emerald-400/50 hover:text-emerald-200"><i data-lucide="refresh-cw" class="size-3.5"></i> Refresh data</button>
    </div>
    ${renderControls()}
    <section class="catchup-results-section">
      <div class="catchup-results-heading">
        <div><h2>${label}</h2><p>${description}</p></div>
        <span class="catchup-count">${items.length}</span>
      </div>
      ${items.length
        ? `<div class="${displayMode === "cards" ? "catchup-grid" : "catchup-list"}">${items.map((item) => card(item, activeSection === "upcoming")).join("")}</div>`
        : renderEmpty(
            "No matching anime found",
            activeFormat === "ALL"
              ? description
              : `No ${formatLabel(activeFormat)} titles in this section. Try another format filter.`
          )}
    </section>
    <p class="mt-8 text-xs leading-relaxed text-zinc-600">This report uses AniList's sequel relationships and release status. Missing or outdated AniList relationships can cause some sequels to be missed. It checks direct sequel links, not every remake, side story, or episode schedule.</p>
  `;

  refreshIcons();
}

function findRecommendations(entries) {
  const entryByMediaId = new Map(
    entries.map((entry) => [entry.media.id, entry])
  );

  const candidates = new Map();

  for (const entry of entries) {
    if (!["COMPLETED", "CURRENT", "PAUSED"].includes(entry.status)) {
      continue;
    }

    const source = entry.media;

    for (const edge of source?.relations?.edges || []) {
      if (edge.relationType !== "SEQUEL") continue;

      const media = edge.node;

      if (!media || media.type !== "ANIME" || media.id === source.id) {
        continue;
      }

      if (entryByMediaId.has(media.id)) continue;

      if (!["FINISHED", "RELEASING", "NOT_YET_RELEASED"].includes(media.status)) {
        continue;
      }

      const existing = candidates.get(media.id);

      if (
        !existing ||
        (existing.media.status === "NOT_YET_RELEASED" &&
          media.status !== "NOT_YET_RELEASED")
      ) {
        candidates.set(media.id, {
          media,
          source,
          relation: edge.relationType,
        });
      }
    }
  }

  const all = [...candidates.values()];

  all.sort(
    (a, b) =>
      (yearOf(b.media) || 0) - (yearOf(a.media) || 0) ||
      titleOf(a.media).localeCompare(titleOf(b.media))
  );

  return {
    available: all.filter((item) =>
      ["FINISHED", "RELEASING"].includes(item.media.status)
    ),
    upcoming: all.filter(
      (item) => item.media.status === "NOT_YET_RELEASED"
    ),
  };
}

/**
 * Fetch every page of the user's AniList anime list.
 * Keeps the existing query, page size, and progress callback.
 */
async function fetchUserEntries(userId, onProgress) {
  const entries = [];
  let page = 1;

  while (true) {
    const data = await gql(LIST_QUERY, {
      userId: Number(userId),
      page,
    });

    const result = data?.Page;

    if (!result) {
      throw new Error("AniList returned an invalid list response.");
    }

    entries.push(
      ...(result.mediaList || []).filter((entry) => entry?.media)
    );

    onProgress?.(entries.length);

    if (!result.pageInfo?.hasNextPage) {
      break;
    }

    page++;

    // Reduce request frequency to help avoid rate limits.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return entries;
}

async function runCatchUp(username, forceRefresh = false) {
  if (requestInProgress) return;

  requestInProgress = true;

  const button = $("#catchup-submit");
  const label = button?.querySelector("span");
  const results = $("#catchup-results");

  if (button) button.disabled = true;
  if (label) label.textContent = "Checking AniList…";
  if (results) results.innerHTML = "";

  currentReport = null;

  setMessage("Looking up the AniList profile…");

  try {
    const userResult = await gql(USER_QUERY, { name: username });
    const user = userResult?.User;

    if (!user) {
      throw new Error("AniList user not found. Check the username and try again.");
    }

    let entries = !forceRefresh ? resultCache.get(user.id) : null;

    if (!entries) {
      setMessage(`Found @${user.name}. Reading the anime list…`);

      entries = await fetchUserEntries(user.id, (count) =>
        setMessage(`Found @${user.name}. Loaded ${count} anime entries…`)
      );

      resultCache.set(user.id, entries);
    }

    const { available, upcoming } = findRecommendations(entries);
    const total = available.length + upcoming.length;

    currentReport = {
      user,
      available,
      upcoming,
      entriesCount: entries.length,
    };

    activeSection = "ready";
    activeFormat = "ALL";
    displayMode = "cards";

    setMessage(
      `Checked ${entries.length} anime entries for @${user.name}. Found ${total} sequel${total === 1 ? "" : "s"} not already on this AniList list.`
    );

    renderResultsPanel();
  } catch (error) {
    console.error("Catch-Up failed:", error);

    setMessage(
      error?.message ||
        "Couldn't load this AniList profile. Please try again later.",
      "error"
    );
  } finally {
    requestInProgress = false;

    if (button) button.disabled = false;
    if (label) label.textContent = "Find Seasons";

    refreshIcons();
  }
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function setView(view) {
  document.querySelectorAll("[data-app-view]").forEach((tab) => {
    const active = tab.dataset.appView === view;

    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });

  document.querySelectorAll("[data-app-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.appPanel !== view;
  });

  refreshIcons();
}

document.addEventListener("click", (event) => {
  const navTab = event.target.closest("[data-app-view]");

  if (navTab) {
    setView(navTab.dataset.appView);
    return;
  }

  const sectionButton = event.target.closest("[data-catchup-section]");

  if (sectionButton && currentReport) {
    activeSection = sectionButton.dataset.catchupSection;
    renderResultsPanel();
    return;
  }

  const formatButton = event.target.closest("[data-catchup-format]");

  if (formatButton && currentReport) {
    activeFormat = formatButton.dataset.catchupFormat;
    renderResultsPanel();
    return;
  }

  const viewButton = event.target.closest("[data-catchup-view]");

  if (viewButton && currentReport) {
    displayMode = viewButton.dataset.catchupView;
    renderResultsPanel();
    return;
  }

  if (event.target.closest("#catchup-refresh")) {
    const username = $("#catchup-username")?.value.trim();

    if (username) {
      runCatchUp(username, true);
    }
  }
});

$("#catchup-form")?.addEventListener("submit", (event) => {
  event.preventDefault();

  const username = $("#catchup-username")?.value.trim();

  if (!username) {
    setMessage("Enter an AniList username first.", "error");
    return;
  }

  runCatchUp(username);
});

setView("picker");
