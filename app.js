const appRoot = document.querySelector("#app");

const state = {
  payload: null,
  selectedId: "",
  search: "",
  error: "",
};

await init();

async function init() {
  try {
    state.payload = await fetch("./data/tree.json", { cache: "no-store" }).then((response) => {
      if (!response.ok) {
        throw new Error("The public family tree could not be loaded.");
      }

      return response.json();
    });
  } catch (error) {
    state.error = error.message;
  }

  state.selectedId = resolveSelectedId();
  render();
}

function render() {
  if (state.error) {
    appRoot.innerHTML = `
      <section class="page-shell">
        <div class="error-state">
          <p class="eyebrow">Public-safe family view</p>
          <h1>Nyakana Family Tree</h1>
          <p>${escapeHtml(state.error)}</p>
        </div>
      </section>
    `;
    return;
  }

  const records = state.payload.records;
  const recordMap = new Map(records.map((record) => [record.id, record]));
  const featured = recordMap.get(state.payload.publication.featuredRecordId);
  const selected =
    recordMap.get(state.selectedId) ||
    featured ||
    recordMap.get(state.payload.publication.defaultSelectedId) ||
    records[0] ||
    null;
  const filtered = filterRecords(records, state.search);

  appRoot.innerHTML = `
    <section class="page-shell">
      <header class="hero">
        <div class="hero-copy">
          <p class="eyebrow">${escapeHtml(state.payload.site.eyebrow || "Public-safe family view")}</p>
          <h1>${escapeHtml(state.payload.site.title || "Nyakana Family Tree")}</h1>
          <p class="lede">${escapeHtml(state.payload.site.description || "")}</p>
          <div class="hero-actions">
            <a class="hero-link" href="${buildMailto("Suggest a correction")}" rel="noreferrer">Suggest a correction</a>
            <a class="hero-link hero-link-secondary" href="${buildMailto("Add my family branch")}" rel="noreferrer">Add your branch</a>
          </div>
        </div>
        <div class="hero-meta">
          <p>Public records online</p>
          <strong>${records.length}</strong>
          <span>Updated ${formatDate(state.payload.generatedAt)}</span>
        </div>
      </header>

      <section class="workspace">
        <div class="rail">
          <label class="search-panel">
            <span>Search by name</span>
            <input id="search-input" type="search" value="${escapeHtml(state.search)}" placeholder="Search the public branch" />
          </label>

          <div class="list-panel">
            <div class="list-panel-header">
              <p class="eyebrow">Visible branch</p>
              <strong>${filtered.length} people</strong>
            </div>
            <div class="list-stack">
              ${filtered.map((record) => renderRecordListItem(record, selected?.id === record.id)).join("")}
            </div>
          </div>
        </div>

        <section class="detail-shell">
          ${selected ? renderDetail(selected, recordMap) : renderEmptyState()}
        </section>
      </section>
    </section>
  `;

  bindEvents();
}

function renderRecordListItem(record, isSelected) {
  return `
    <button class="record-item ${isSelected ? "is-selected" : ""}" type="button" data-select-id="${escapeHtml(record.id)}">
      <span class="record-name">${escapeHtml(record.name)}</span>
      <span class="record-meta">${escapeHtml(record.lifeSpan)}</span>
    </button>
  `;
}

function renderDetail(record, recordMap) {
  const parents = resolvePeople(record.relationships.parentIds, recordMap);
  const partners = resolvePeople(record.relationships.spouseIds, recordMap);
  const children = resolvePeople(record.relationships.childIds, recordMap);
  const siblings = resolvePeople(record.relationships.siblingIds, recordMap);

  return `
    <article class="feature-panel">
      <div class="feature-card ${record.id === state.payload.publication.featuredRecordId ? "is-featured" : ""}">
        <p class="feature-tag">${record.id === state.payload.publication.featuredRecordId && state.payload.publication.featuredRecordId ? "Family heart" : state.payload.site.treeLabel || "Public family branch"}</p>
        <h2>${escapeHtml(record.name)}</h2>
        ${record.summary ? `<p class="feature-summary">${escapeHtml(record.summary)}</p>` : ""}
        <div class="feature-chips">
          <span>${escapeHtml(record.lifeSpan)}</span>
          ${record.location ? `<span>${escapeHtml(record.location)}</span>` : ""}
          ${record.isDeceased ? `<span>Remembered ancestor</span>` : `<span>Public-safe branch record</span>`}
        </div>
      </div>

      <div class="relationship-groups">
        ${renderRelationshipGroup("Parents", parents)}
        ${renderRelationshipGroup("Partners", partners)}
        ${renderRelationshipGroup("Children", children)}
        ${renderRelationshipGroup("Siblings", siblings)}
      </div>

      <div class="footer-cta">
        <p>This public-safe branch is stewarded offline and republished as the family archive grows.</p>
        <a class="hero-link" href="${buildMailto(`Update for ${record.name}`)}" rel="noreferrer">Send an update for ${escapeHtml(record.name)}</a>
      </div>
    </article>
  `;
}

function renderRelationshipGroup(label, people) {
  if (!people.length) {
    return "";
  }

  return `
    <section class="relationship-group">
      <div class="relationship-heading">
        <h3>${escapeHtml(label)}</h3>
        <span>${people.length}</span>
      </div>
      <div class="relationship-list">
        ${people
          .map(
            (person) => `
              <button class="relationship-row" type="button" data-select-id="${escapeHtml(person.id)}">
                <span class="relationship-name">${escapeHtml(person.name)}</span>
                <span class="relationship-life">${escapeHtml(person.lifeSpan)}</span>
              </button>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderEmptyState() {
  return `
    <article class="feature-panel">
      <div class="feature-card">
        <p class="feature-tag">Public family branch</p>
        <h2>No public-safe records yet</h2>
        <p class="feature-summary">The steward team has not published the first public branch view yet.</p>
      </div>
    </article>
  `;
}

function bindEvents() {
  document.querySelector("#search-input")?.addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });

  document.querySelectorAll("[data-select-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.selectId || "";
      const params = new URLSearchParams(window.location.search);
      params.set("person", state.selectedId);
      window.history.replaceState({}, "", `${window.location.pathname}?${params}`);
      render();
    });
  });
}

function resolveSelectedId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("person") || "";
}

function filterRecords(records, search) {
  const term = search.trim().toLowerCase();

  if (!term) {
    return records;
  }

  return records.filter((record) => record.name.toLowerCase().includes(term));
}

function resolvePeople(ids, recordMap) {
  return ids.map((id) => recordMap.get(id)).filter(Boolean);
}

function buildMailto(subject) {
  const email = state.payload.site.contactEmail || "";
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}`;
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
  } catch {
    return value;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
