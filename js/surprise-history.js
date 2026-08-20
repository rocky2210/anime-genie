const STORAGE_KEY = "anime-genie:surprise-history";
const MAX_ITEMS = 50;

let history = [];
let callbacks = {};

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

function loadHistory() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? JSON.parse(raw) : [];

		history = Array.isArray(parsed) ? parsed : [];
	} catch {
		history = [];
	}
}

function saveHistory() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
	} catch {
		// Storage can be unavailable in private or restricted browser modes.
	}
}

function titleFor(entry) {
	const media = entry?.media ?? {};

	return (
		media.title?.english ??
		media.title?.romaji ??
		media.title?.native ??
		"Untitled"
	);
}

function coverFor(entry) {
	const media = entry?.media ?? {};

	return media.coverImage?.large ?? media.coverImage?.extraLarge ?? "";
}

function metaFor(item) {
	const media = item.entry?.media ?? {};
	const parts = [
		item.presetLabel,
		media.type,
		media.format,
		media.seasonYear ?? media.startDate?.year,
	].filter(Boolean);

	return parts.join(" • ");
}

function setModeVisible(mode) {
	const root = document.querySelector("#surprise-history-root");

	if (!root) return;

	root.classList.toggle("hidden", mode !== "random");
}

function renderHistory() {
	const count = document.querySelector("#surprise-history-count");
	const panel = document.querySelector("#surprise-history-panel");
	const toggle = document.querySelector("#surprise-history-toggle");

	if (count) {
		count.textContent = String(history.length);
	}

	if (toggle) {
		toggle.disabled = history.length === 0;
	}

	if (!panel) return;

	if (!history.length) {
		panel.innerHTML = `
			<p class="surprise-history-empty">
				No random picks saved yet.
			</p>
		`;

		callbacks.refreshIcons?.();
		return;
	}

	panel.innerHTML = `
		<div class="surprise-history-head">
			<span>Previous random picks</span>
			<button
				type="button"
				class="surprise-history-clear"
				data-history-clear
			>
				Clear all
			</button>
		</div>

		<div class="surprise-history-list">
			${history
				.map(
					(item) => `
						<article class="surprise-history-item">
							${
								coverFor(item.entry)
									? `
										<img
											src="${esc(coverFor(item.entry))}"
											alt=""
											class="surprise-history-cover"
										>
									`
									: `
										<div class="surprise-history-cover surprise-history-cover-empty">
											?
										</div>
									`
							}

							<div class="surprise-history-body">
								<p class="surprise-history-title">
									${esc(titleFor(item.entry))}
								</p>

								<p class="surprise-history-meta">
									${esc(metaFor(item))}
								</p>
							</div>

							<div class="surprise-history-actions">
								<button
									type="button"
									class="surprise-history-action"
									data-history-show="${esc(item.id)}"
								>
									Show
								</button>

								<button
									type="button"
									class="surprise-history-action danger"
									data-history-remove="${esc(item.id)}"
									aria-label="Remove ${esc(titleFor(item.entry))}"
								>
									<i data-lucide="x" class="size-4"></i>
								</button>
							</div>
						</article>
					`
				)
				.join("")}
		</div>
	`;

	callbacks.refreshIcons?.();
}

function togglePanel() {
	const panel = document.querySelector("#surprise-history-panel");
	const toggle = document.querySelector("#surprise-history-toggle");

	if (!panel || !toggle || !history.length) return;

	const isHidden = panel.classList.toggle("hidden");

	toggle.setAttribute("aria-expanded", String(!isHidden));
}

function removeHistoryItem(id) {
	history = history.filter((item) => item.id !== id);
	saveHistory();
	renderHistory();
}

function clearHistory() {
	history = [];
	saveHistory();
	renderHistory();
}

export async function initSurpriseHistoryUI({
	onShow,
	refreshIcons,
	mode = "user",
} = {}) {
	if (typeof document === "undefined") {
		return;
	}

	callbacks = {
		onShow,
		refreshIcons,
	};

	const root = document.querySelector("#surprise-history-root");

	if (!root) return;

	try {
		const res = await fetch("./components/surprise-history.html");

		if (!res.ok) {
			throw new Error("History fragment unavailable");
		}

		root.innerHTML = await res.text();
	} catch {
		root.innerHTML = `
			<div class="surprise-history">
				<button
					id="surprise-history-toggle"
					type="button"
					class="surprise-history-toggle"
					aria-expanded="false"
				>
					<i data-lucide="history" class="size-4"></i>
					<span>Random Pick History</span>
					<span id="surprise-history-count" class="surprise-history-count">0</span>
				</button>

				<div
					id="surprise-history-panel"
					class="surprise-history-panel hidden"
				></div>
			</div>
		`;
	}

	loadHistory();
	setModeVisible(mode);
	renderHistory();
	refreshIcons?.();

	root.addEventListener("click", (event) => {
		if (event.target.closest("#surprise-history-toggle")) {
			togglePanel();
			return;
		}

		const show = event.target.closest("[data-history-show]");

		if (show) {
			const item = history.find(
				(entry) => entry.id === show.dataset.historyShow
			);

			if (item) {
				callbacks.onShow?.(item.entry);
			}

			return;
		}

		const remove = event.target.closest("[data-history-remove]");

		if (remove) {
			removeHistoryItem(remove.dataset.historyRemove);
			return;
		}

		if (event.target.closest("[data-history-clear]")) {
			clearHistory();
		}
	});
}

export function setSurpriseHistoryMode(mode) {
	if (typeof document === "undefined") {
		return;
	}

	setModeVisible(mode);
}

export function addSurpriseHistoryEntry(entry, presetLabel = "Random Pick") {
	if (!entry?.media) {
		return;
	}

	loadHistory();

	const item = {
		id: `${Date.now()}-${entry.media.id}`,
		presetLabel,
		entry,
		createdAt: new Date().toISOString(),
	};

	history = [
		item,
		...history.filter(
			(old) => String(old.entry?.media?.id) !== String(entry.media.id)
		),
	].slice(0, MAX_ITEMS);

	saveHistory();
	renderHistory();
}
