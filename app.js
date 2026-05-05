const appRoot = document.querySelector("#app");
const ACCESS_STORAGE_KEY = "nyakana-family-tree-access-code";
const STEWARD_STORAGE_KEY = "nyakana-family-tree-steward";
const APP_BASE_URL = new URL("./", document.querySelector('script[src$="app.js"]')?.src || window.location.href);

const state = {
  payload: null,
  unlockedPayload: null,
  selectedId: "",
  search: "",
  accessCode: "",
  steward: loadStoredSteward(),
  stewardSearch: "",
  stewardSelectedId: "",
  stewardSaving: false,
  stewardMessage: "",
  stewardError: "",
  error: "",
  unlockError: "",
  unlocking: false,
};

await init();

async function init() {
  try {
    state.payload = await fetch(new URL("data/tree.json", APP_BASE_URL), { cache: "no-store" }).then((response) => {
      if (!response.ok) {
        throw new Error("The family tree could not be loaded.");
      }

      return response.json();
    });

    if (state.payload?.publication?.codeProtected) {
      const rememberedCode = window.localStorage.getItem(ACCESS_STORAGE_KEY) || "";
      if (rememberedCode) {
        state.accessCode = rememberedCode;
        await unlockWithCode(rememberedCode, { silentFailure: true });
      }
    } else {
      state.unlockedPayload = state.payload;
    }
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
          <p class="eyebrow">Family tree</p>
          <h1>Nyakana Family Tree</h1>
          <p>${escapeHtml(state.error)}</p>
        </div>
      </section>
    `;
    return;
  }

  if (isStewardRoute()) {
    renderStewardStudio(state.unlockedPayload || state.payload);
    return;
  }

  if (state.payload?.publication?.codeProtected && !state.unlockedPayload) {
    renderUnlockGate();
    return;
  }

  renderTreeView(state.unlockedPayload || state.payload);
}

function renderUnlockGate() {
  appRoot.innerHTML = `
    <section class="page-shell page-shell-gated">
      <header class="hero hero-gated">
        <div class="hero-copy">
          <p class="eyebrow">${escapeHtml(state.payload.site.eyebrow || "Protected family tree")}</p>
          <h1>${escapeHtml(state.payload.site.title || "Nyakana Family Tree")}</h1>
          <p class="lede">${escapeHtml(state.payload.site.unlockDescription || state.payload.site.description || "")}</p>
        </div>
      </header>

      <section class="unlock-shell">
        <article class="unlock-card">
          <p class="feature-tag">Family access required</p>
          <h2>${escapeHtml(state.payload.site.unlockTitle || "Open the family tree")}</h2>
          <p class="unlock-copy">${escapeHtml(state.payload.site.unlockHint || "Ask a steward for a valid family access code.")}</p>
          <form id="unlock-form" class="unlock-form">
            <label>
              <span>Family access code</span>
              <input
                id="access-code-input"
                type="password"
                name="accessCode"
                autocomplete="one-time-code"
                placeholder="Enter your steward-issued code"
                value="${escapeHtml(state.accessCode)}"
                required
              />
            </label>
            <button class="hero-link" type="submit" ${state.unlocking ? "disabled" : ""}>${state.unlocking ? "Opening tree..." : "Open the family tree"}</button>
          </form>
          ${state.unlockError ? `<p class="unlock-error">${escapeHtml(state.unlockError)}</p>` : ""}
        </article>
      </section>
    </section>
  `;

  document.querySelector("#unlock-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get("accessCode")?.toString().trim() || "";
    state.accessCode = code;
    state.unlocking = true;
    state.unlockError = "";
    render();

    await unlockWithCode(code);
    state.unlocking = false;
    render();
  });
}

function renderTreeView(payload) {
  const records = payload.records;
  const recordMap = new Map(records.map((record) => [record.id, record]));
  const featured = recordMap.get(payload.publication.featuredRecordId);
  const selected =
    recordMap.get(state.selectedId) ||
    featured ||
    recordMap.get(payload.publication.defaultSelectedId) ||
    records[0] ||
    null;
  const filtered = filterRecords(records, state.search);

  appRoot.innerHTML = `
    <section class="page-shell">
      <header class="hero">
        <div class="hero-copy">
          <p class="eyebrow">${escapeHtml(payload.site.eyebrow || "Family tree")}</p>
          <h1>${escapeHtml(payload.site.title || "Nyakana Family Tree")}</h1>
          <p class="lede">${escapeHtml(payload.site.description || "")}</p>
          <div class="hero-actions">
            <a class="hero-link" href="${escapeHtml(resolveContributionHref(payload, "Suggest a correction"))}" rel="noreferrer">Suggest a correction</a>
            <a class="hero-link hero-link-secondary" href="${escapeHtml(resolveContributionHref(payload, "Add my family branch"))}" rel="noreferrer">Add your branch</a>
            ${payload.stewardStudio?.enabled ? `<a class="hero-link hero-link-ghost" href="${escapeHtml(payload.site.stewardUrl || "./steward")}">Steward Studio</a>` : ""}
            ${payload.publication.codeProtected ? `<button class="hero-link hero-link-ghost" id="lock-tree-button" type="button">Lock tree</button>` : ""}
          </div>
        </div>
        <div class="hero-meta">
          <p>Family records online</p>
          <strong>${records.length}</strong>
          <span>Updated ${formatDate(payload.generatedAt)}</span>
        </div>
      </header>

      <section class="workspace">
        <div class="rail">
          <label class="search-panel">
            <span>Search by name</span>
            <input id="search-input" type="search" value="${escapeHtml(state.search)}" placeholder="Search the family tree" />
          </label>

          <div class="list-panel">
            <div class="list-panel-header">
              <p class="eyebrow">Visible family records</p>
              <strong>${filtered.length} people</strong>
            </div>
            <div class="list-stack">
              ${filtered.map((record) => renderRecordListItem(record, selected?.id === record.id)).join("")}
            </div>
          </div>
        </div>

        <section class="detail-shell">
          ${selected ? renderDetail(selected, recordMap, payload) : renderEmptyState(payload)}
        </section>
      </section>
    </section>
  `;

  bindTreeEvents(payload);
}

function renderStewardStudio(payload) {
  if (!payload?.stewardStudio?.enabled) {
    appRoot.innerHTML = `
      <section class="page-shell">
        <div class="error-state">
          <p class="eyebrow">Steward Studio</p>
          <h1>Studio unavailable</h1>
          <p>The online editor has not been enabled for this tree yet.</p>
        </div>
      </section>
    `;
    return;
  }

  if (!state.steward?.name || !state.steward?.token) {
    renderStewardGate(payload);
    return;
  }

  const records = [...payload.records].sort((left, right) => left.name.localeCompare(right.name));
  const filtered = filterRecords(records, state.stewardSearch);
  const selected =
    records.find((record) => record.id === state.stewardSelectedId) ||
    records.find((record) => record.id === payload.publication.featuredRecordId) ||
    records[0] ||
    null;

  appRoot.innerHTML = `
    <section class="page-shell">
      <header class="hero steward-hero">
        <div class="hero-copy">
          <p class="eyebrow">Steward Studio</p>
          <h1>Update the Nyakana family tree</h1>
          <p class="lede">Signed in as ${escapeHtml(state.steward.name)}. Changes publish to GitHub Pages after saving.</p>
          <div class="hero-actions">
            <a class="hero-link hero-link-secondary" href="./">View tree</a>
            <button class="hero-link hero-link-ghost" id="steward-logout-button" type="button">Sign out</button>
          </div>
        </div>
        <div class="hero-meta">
          <p>Records online</p>
          <strong>${records.length}</strong>
          <span>Updated ${formatDate(payload.generatedAt)}</span>
        </div>
      </header>

      ${renderStewardStatus()}

      <section class="steward-editor-grid">
        <article class="steward-panel">
          <p class="eyebrow">Add member</p>
          <h2>Add a new member to the tree</h2>
          ${renderOnlinePersonForm(buildEmptyOnlineRecord(), payload, { formId: "online-new-person-form", submitLabel: "Create and publish" })}
        </article>

        <aside class="steward-panel">
          <p class="eyebrow">Find record</p>
          <label class="search-panel steward-search">
            <span>Search by name</span>
            <input id="steward-search-input" type="search" value="${escapeHtml(state.stewardSearch)}" placeholder="Search existing records" />
          </label>
          <div class="list-stack steward-record-list">
            ${filtered.map((record) => renderStewardRecordButton(record, selected?.id === record.id)).join("")}
          </div>
        </aside>

        <article class="steward-panel steward-panel-wide">
          <p class="eyebrow">Edit record</p>
          <h2>${selected ? `Edit ${escapeHtml(selected.name)}` : "No record selected"}</h2>
          ${selected ? renderOnlinePersonForm(selected, payload, { formId: "online-existing-person-form", submitLabel: "Save and publish" }) : ""}
        </article>
      </section>
    </section>
  `;

  bindStewardStudioEvents(payload);
}

function renderStewardGate(payload) {
  appRoot.innerHTML = `
    <section class="page-shell page-shell-gated">
      <header class="hero hero-gated">
        <div class="hero-copy">
          <p class="eyebrow">Steward Studio</p>
          <h1>Open the editing studio</h1>
          <p class="lede">Use your steward code and publishing token to update the online tree.</p>
        </div>
      </header>

      <section class="unlock-shell">
        <article class="unlock-card">
          <p class="feature-tag">Steward access</p>
          <h2>Sign in to manage records</h2>
          <form id="online-steward-login-form" class="unlock-form">
            <label>
              <span>Steward name</span>
              <select name="name" required>
                <option value="">Choose steward</option>
                ${payload.stewardStudio.stewards.map((steward) => `<option value="${escapeHtml(steward.name)}">${escapeHtml(steward.name)}</option>`).join("")}
              </select>
            </label>
            <label>
              <span>Steward code</span>
              <input type="password" name="code" autocomplete="one-time-code" placeholder="Example: RONALD-NYAKANA-STEWARD" required />
            </label>
            <label>
              <span>Publishing token</span>
              <input type="password" name="token" autocomplete="off" placeholder="GitHub token for the Pages repo" required />
            </label>
            <button class="hero-link" type="submit">Open Steward Studio</button>
          </form>
          ${state.stewardError ? `<p class="unlock-error">${escapeHtml(state.stewardError)}</p>` : ""}
        </article>
      </section>
    </section>
  `;

  document.querySelector("#online-steward-login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = form.get("name")?.toString() || "";
    const code = form.get("code")?.toString() || "";
    const token = form.get("token")?.toString() || "";
    const isValid = await validateStewardCode(payload.stewardStudio.stewards, name, code);

    if (!isValid) {
      state.stewardError = "That steward name and code did not match.";
      renderStewardGate(payload);
      return;
    }

    state.steward = { name, token };
    state.stewardError = "";
    window.localStorage.setItem(STEWARD_STORAGE_KEY, JSON.stringify(state.steward));
    renderStewardStudio(payload);
  });
}

function renderStewardStatus() {
  if (!state.stewardMessage && !state.stewardError) {
    return "";
  }

  return `
    <div class="steward-status ${state.stewardError ? "is-error" : ""}">
      ${escapeHtml(state.stewardError || state.stewardMessage)}
    </div>
  `;
}

function renderStewardRecordButton(record, isSelected) {
  return `
    <button class="record-item ${isSelected ? "is-selected" : ""}" type="button" data-steward-select-id="${escapeHtml(record.id)}">
      <span class="record-name">${escapeHtml(record.name)}</span>
      <span class="record-meta">${escapeHtml(record.lifeSpan || "Dates not yet captured")}</span>
    </button>
  `;
}

function renderOnlinePersonForm(record, payload, options) {
  const records = [...payload.records].sort((left, right) => left.name.localeCompare(right.name));
  const relationships = record.relationships || { parentIds: [], spouseIds: [], childIds: [], siblingIds: [] };

  return `
    <form id="${escapeHtml(options.formId)}" class="online-person-form" data-record-id="${escapeHtml(record.id || "")}">
      <label>
        <span>Name</span>
        <input type="text" name="name" value="${escapeHtml(record.name || "")}" required />
      </label>
      <div class="form-two-up">
        <label>
          <span>Life facts</span>
          <input type="text" name="lifeSpan" value="${escapeHtml(record.lifeSpan || "")}" placeholder="Born 1944" />
        </label>
        <label>
          <span>Location</span>
          <input type="text" name="location" value="${escapeHtml(record.location || "")}" placeholder="Uganda" />
        </label>
      </div>
      <label>
        <span>Branch label</span>
        <input type="text" name="branch" value="${escapeHtml(record.branch || "")}" placeholder="Child of..." />
      </label>
      <label>
        <span>Summary</span>
        <textarea name="summary" rows="3">${escapeHtml(record.summary || "")}</textarea>
      </label>
      <div class="form-two-up">
        ${renderOnlineRelationshipSelect("Parents", "parentIds", relationships.parentIds, records, record.id)}
        ${renderOnlineRelationshipSelect("Partners", "spouseIds", relationships.spouseIds, records, record.id)}
      </div>
      ${renderOnlineRelationshipSelect("Children", "childIds", relationships.childIds, records, record.id)}
      <button class="hero-link" type="submit" ${state.stewardSaving ? "disabled" : ""}>${state.stewardSaving ? "Publishing..." : escapeHtml(options.submitLabel)}</button>
    </form>
  `;
}

function renderOnlineRelationshipSelect(label, name, selectedIds = [], records, currentId) {
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <select name="${escapeHtml(name)}" multiple size="6">
        ${records
          .filter((record) => record.id !== currentId)
          .map((record) => `<option value="${escapeHtml(record.id)}" ${selectedIds.includes(record.id) ? "selected" : ""}>${escapeHtml(record.name)}</option>`)
          .join("")}
      </select>
    </label>
  `;
}

function bindStewardStudioEvents(payload) {
  document.querySelector("#steward-logout-button")?.addEventListener("click", () => {
    state.steward = null;
    window.localStorage.removeItem(STEWARD_STORAGE_KEY);
    renderStewardStudio(payload);
  });

  document.querySelector("#steward-search-input")?.addEventListener("input", (event) => {
    state.stewardSearch = event.currentTarget.value;
    renderStewardStudio(payload);
  });

  document.querySelectorAll("[data-steward-select-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.stewardSelectedId = button.dataset.stewardSelectId || "";
      renderStewardStudio(payload);
    });
  });

  document.querySelectorAll(".online-person-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveOnlinePerson(payload, event.currentTarget);
    });
  });
}

async function saveOnlinePerson(payload, form) {
  state.stewardSaving = true;
  state.stewardMessage = "";
  state.stewardError = "";
  renderStewardStudio(payload);

  try {
    const nextPayload = clonePayload(payload);
    const formData = new FormData(form);
    const existingId = form.dataset.recordId || "";
    const person = {
      id: existingId || `person_${window.crypto.randomUUID().slice(0, 10)}`,
      name: formData.get("name")?.toString().trim() || "",
      lifeSpan: formData.get("lifeSpan")?.toString().trim() || "Dates not yet captured",
      location: formData.get("location")?.toString().trim() || "",
      branch: formData.get("branch")?.toString().trim() || "Family branch",
      summary: formData.get("summary")?.toString().trim() || "",
      isDeceased: false,
      isPatriarch: existingId === nextPayload.publication.featuredRecordId,
      visibility: nextPayload.publication.mode || "family-open",
      relationships: {
        parentIds: formData.getAll("parentIds").map(String),
        spouseIds: formData.getAll("spouseIds").map(String),
        childIds: formData.getAll("childIds").map(String),
        siblingIds: [],
      },
    };

    if (!person.name) {
      throw new Error("A name is required before publishing.");
    }

    const existingIndex = nextPayload.records.findIndex((record) => record.id === person.id);
    if (existingIndex >= 0) {
      nextPayload.records[existingIndex] = { ...nextPayload.records[existingIndex], ...person };
    } else {
      nextPayload.records.push(person);
    }

    normalizePublishedRelationships(nextPayload.records);
    nextPayload.records.sort((left, right) => left.name.localeCompare(right.name));
    nextPayload.generatedAt = new Date().toISOString();
    nextPayload.publication.visibleRecordCount = nextPayload.records.length;

    await publishPayloadToGithub(nextPayload, person);
    state.payload = nextPayload;
    state.unlockedPayload = nextPayload;
    state.stewardSelectedId = person.id;
    state.stewardSearch = person.name;
    state.stewardMessage = `${person.name} was published to the online tree. GitHub Pages may take a minute to refresh.`;
  } catch (error) {
    state.stewardError = error.message || "The record could not be published.";
  } finally {
    state.stewardSaving = false;
    renderStewardStudio(state.unlockedPayload || state.payload);
  }
}

async function publishPayloadToGithub(payload, person) {
  const repo = payload.stewardStudio.repo;
  const apiUrl = `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${repo.dataPath}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${state.steward.token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const current = await fetch(`${apiUrl}?ref=${encodeURIComponent(repo.branch)}`, { headers }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.message || "Could not read the current published tree from GitHub.");
    }
    return body;
  });
  const content = toBase64Utf8(JSON.stringify(payload, null, 2) + "\n");
  const response = await fetch(apiUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      branch: repo.branch,
      message: `Update family tree record: ${person.name}`,
      content,
      sha: current.sha,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || "GitHub did not accept the published tree update.");
  }
}

function normalizePublishedRelationships(records) {
  const recordMap = new Map(records.map((record) => [record.id, record]));
  for (const record of records) {
    const relationships = record.relationships || {};
    record.relationships = {
      parentIds: unique((relationships.parentIds || []).filter((id) => id !== record.id && recordMap.has(id))),
      spouseIds: unique((relationships.spouseIds || []).filter((id) => id !== record.id && recordMap.has(id))),
      childIds: [],
      siblingIds: [],
    };
  }

  for (const record of records) {
    for (const spouseId of record.relationships.spouseIds) {
      const spouse = recordMap.get(spouseId);
      spouse.relationships.spouseIds = unique([...(spouse.relationships.spouseIds || []), record.id]);
    }
  }

  for (const record of records) {
    for (const parentId of record.relationships.parentIds) {
      const parent = recordMap.get(parentId);
      parent.relationships.childIds = unique([...(parent.relationships.childIds || []), record.id]);
    }
  }

  for (const record of records) {
    const siblingIds = new Set();
    for (const parentId of record.relationships.parentIds) {
      const parent = recordMap.get(parentId);
      for (const childId of parent?.relationships.childIds || []) {
        if (childId !== record.id) {
          siblingIds.add(childId);
        }
      }
    }
    record.relationships.siblingIds = [...siblingIds].sort();
  }
}

function buildEmptyOnlineRecord() {
  return {
    id: "",
    name: "",
    lifeSpan: "",
    location: "",
    branch: "",
    summary: "",
    relationships: {
      parentIds: [],
      spouseIds: [],
      childIds: [],
      siblingIds: [],
    },
  };
}

async function validateStewardCode(stewards, name, code) {
  const steward = stewards.find((entry) => entry.name === name);
  if (!steward) {
    return false;
  }

  return (await sha256Hex(`${steward.salt}:${code.trim()}`)) === steward.codeHash;
}

async function sha256Hex(value) {
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clonePayload(payload) {
  return JSON.parse(JSON.stringify(payload));
}

function unique(values) {
  return [...new Set(values)].sort();
}

function toBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return window.btoa(binary);
}

function renderRecordListItem(record, isSelected) {
  return `
    <button class="record-item ${isSelected ? "is-selected" : ""}" type="button" data-select-id="${escapeHtml(record.id)}">
      <span class="record-name">${escapeHtml(record.name)}</span>
      <span class="record-meta">${escapeHtml(record.lifeSpan)}</span>
    </button>
  `;
}

function renderDetail(record, recordMap, payload) {
  const parents = resolvePeople(record.relationships.parentIds, recordMap);
  const partners = resolvePeople(record.relationships.spouseIds, recordMap);
  const children = resolvePeople(record.relationships.childIds, recordMap);
  const siblings = resolvePeople(record.relationships.siblingIds, recordMap);

  return `
    <article class="feature-panel">
      <div class="feature-card ${record.id === payload.publication.featuredRecordId ? "is-featured" : ""}">
        <p class="feature-tag">${record.id === payload.publication.featuredRecordId && payload.publication.featuredRecordId ? "Family heart" : payload.site.treeLabel || "Family branch"}</p>
        <h2>${escapeHtml(record.name)}</h2>
        ${record.summary ? `<p class="feature-summary">${escapeHtml(record.summary)}</p>` : ""}
        <div class="feature-chips">
          <span>${escapeHtml(record.lifeSpan)}</span>
          ${record.location ? `<span>${escapeHtml(record.location)}</span>` : ""}
          ${record.isDeceased ? `<span>Remembered ancestor</span>` : `<span>Family record</span>`}
        </div>
      </div>

      <div class="relationship-groups">
        ${renderRelationshipGroup("Parents", parents)}
        ${renderRelationshipGroup("Partners", partners)}
        ${renderRelationshipGroup("Children", children)}
        ${renderRelationshipGroup("Siblings", siblings)}
      </div>

      <div class="footer-cta">
        <p>The steward team updates the master archive offline and republishes the family tree after approved changes.</p>
        <a class="hero-link" href="${escapeHtml(resolveContributionHref(payload, `Update for ${record.name}`))}" rel="noreferrer">Send an update for ${escapeHtml(record.name)}</a>
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

function renderEmptyState(payload) {
  return `
    <article class="feature-panel">
      <div class="feature-card">
        <p class="feature-tag">${escapeHtml(payload.site.treeLabel || "Family branch")}</p>
        <h2>No records are available yet</h2>
        <p class="feature-summary">The steward team has not published this branch yet.</p>
      </div>
    </article>
  `;
}

function bindTreeEvents(payload) {
  document.querySelector("#search-input")?.addEventListener("input", (event) => {
    state.search = event.target.value;
    renderTreeView(payload);
  });

  document.querySelectorAll("[data-select-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.selectId || "";
      const params = new URLSearchParams(window.location.search);
      params.set("person", state.selectedId);
      window.history.replaceState({}, "", `${window.location.pathname}?${params}`);
      renderTreeView(payload);
    });
  });

  document.querySelector("#lock-tree-button")?.addEventListener("click", () => {
    window.localStorage.removeItem(ACCESS_STORAGE_KEY);
    state.unlockedPayload = null;
    state.accessCode = "";
    state.unlockError = "";
    render();
  });
}

function resolveSelectedId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("person") || "";
}

function isStewardRoute() {
  return /\/steward\/?$/u.test(window.location.pathname) || window.location.hash === "#steward";
}

function loadStoredSteward() {
  try {
    return JSON.parse(window.localStorage.getItem(STEWARD_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
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

function buildMailto(email, subject) {
  return `mailto:${encodeURIComponent(email || "")}?subject=${encodeURIComponent(subject)}`;
}

function resolveContributionHref(payload, subject) {
  const contributionUrl = payload?.site?.contributionUrl?.trim();
  if (contributionUrl) {
    return contributionUrl;
  }

  return buildMailto(payload?.site?.contactEmail, subject);
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

async function unlockWithCode(code, options = {}) {
  if (!code || !state.payload?.protectedData?.keyrings?.length) {
    if (!options.silentFailure) {
      state.unlockError = "A valid family access code is required.";
    }
    return false;
  }

  try {
    const unlocked = await decryptPayload(state.payload, code.trim());
    state.unlockedPayload = unlocked;
    state.unlockError = "";
    window.localStorage.setItem(ACCESS_STORAGE_KEY, code.trim());
    if (!state.selectedId) {
      state.selectedId = unlocked.publication.defaultSelectedId || unlocked.records[0]?.id || "";
    }
    return true;
  } catch (error) {
    if (!options.silentFailure) {
      state.unlockError = "That code could not open the family tree. Please check it and try again.";
    } else {
      window.localStorage.removeItem(ACCESS_STORAGE_KEY);
    }
    return false;
  }
}

async function decryptPayload(payload, code) {
  const protectedData = payload.protectedData;
  const wrappedKey = await findWorkingKey(protectedData, code);
  if (!wrappedKey) {
    throw new Error("No matching keyring entry");
  }

  const cryptoKey = await window.crypto.subtle.importKey("raw", wrappedKey, "AES-GCM", false, ["decrypt"]);
  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decodeBase64Url(protectedData.payloadIv),
      tagLength: 128,
    },
    cryptoKey,
    concatCiphertextAndTag(protectedData.payloadCiphertext, protectedData.payloadTag)
  );

  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function findWorkingKey(protectedData, code) {
  for (const entry of protectedData.keyrings) {
    try {
      const derivedKey = await deriveWrappingKey(code, entry.salt, protectedData.iterations);
      const cryptoKey = await window.crypto.subtle.importKey("raw", derivedKey, "AES-GCM", false, ["decrypt"]);
      const decryptedKey = await window.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decodeBase64Url(entry.iv),
          tagLength: 128,
        },
        cryptoKey,
        concatCiphertextAndTag(entry.ciphertext, entry.tag)
      );

      return new Uint8Array(decryptedKey);
    } catch {
      // Try the next keyring entry until one succeeds.
    }
  }

  return null;
}

async function deriveWrappingKey(code, salt, iterations) {
  const codeKey = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(code),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: decodeBase64Url(salt),
      iterations,
    },
    codeKey,
    256
  );

  return new Uint8Array(bits);
}

function concatCiphertextAndTag(ciphertext, tag) {
  const cipherBytes = decodeBase64Url(ciphertext);
  const tagBytes = decodeBase64Url(tag);
  const combined = new Uint8Array(cipherBytes.length + tagBytes.length);
  combined.set(cipherBytes, 0);
  combined.set(tagBytes, cipherBytes.length);
  return combined;
}

function decodeBase64Url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = window.atob(normalized + padding);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
