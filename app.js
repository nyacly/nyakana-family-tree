const appRoot = document.querySelector("#app");
const ACCESS_STORAGE_KEY = "nyakana-family-tree-access-code";
const STEWARD_STORAGE_KEY = "nyakana-family-tree-steward";
const STEWARD_TOKEN_STORAGE_KEY = "nyakana-family-tree-publishing-token";
const TREE_VIEW_STORAGE_KEY = "nyakana-family-tree-view";
const APP_BASE_URL = new URL("./", document.querySelector('script[src$="app.js"]')?.src || window.location.href);

const state = {
  payload: null,
  unlockedPayload: null,
  selectedId: "",
  treeView: window.localStorage.getItem(TREE_VIEW_STORAGE_KEY) || "person",
  recentlyViewed: [],
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
  const activeView = normalizeTreeView(state.treeView);

  appRoot.innerHTML = `
    <section class="page-shell viewer-page">
      ${renderViewerTopbar(payload, featured)}

      <header class="hero viewer-hero">
        <div class="hero-copy">
          <h1>The Nyakana family tree</h1>
          <p class="lede">Find a relative, see how everyone is connected, and help us keep the family record accurate. Anyone can suggest an update - a steward reviews each one before it is saved.</p>
        </div>
        <div class="hero-stat">
          <span class="label">People in the tree</span>
          <span class="num">${records.length}</span>
          <span class="sub">Last updated ${formatDate(payload.generatedAt)}</span>
        </div>
      </header>

      ${renderSearchBox(filtered, selected)}
      ${renderTreeTabs(activeView)}
      ${renderRecentChips(recordMap)}

      <section class="viewer-workspace">
        ${selected ? renderTreePanel(activeView, featured || selected, selected, recordMap, payload) : renderEmptyState(payload)}
        ${selected ? renderDetail(selected, recordMap, payload) : ""}
      </section>

      <p class="footnote">
        Stewards: ${escapeHtml((payload.meta?.stewards || ["Cnyakana", "Nyacly", "Ronald Nyakana"]).join(" · "))} · Updates publish after steward review.
      </p>
    </section>
  `;

  bindTreeEvents(payload);
}

function renderViewerTopbar(payload, featured) {
  return `
    <header class="topbar">
      <button class="brand" type="button" ${featured ? `data-select-id="${escapeHtml(featured.id)}"` : ""}>
        <span class="brand-mark">N</span>
        <span class="brand-text">
          <span class="brand-eyebrow">Family Tree</span>
          <span class="brand-title">Nyakana</span>
        </span>
      </button>
      <div class="topbar-actions">
        <a class="btn btn--sm" href="${escapeHtml(resolveContributionHref(payload, "How are we related?"))}" rel="noreferrer">
          ${renderIcon("link")} <span>How are we related?</span>
        </a>
        <a class="btn btn--sm btn--primary" href="${escapeHtml(resolveContributionHref(payload, "Add a person to the Nyakana family tree"))}" rel="noreferrer">
          ${renderIcon("plus")} <span>Add a person</span>
        </a>
        ${payload.publication.codeProtected ? `<button class="btn btn--sm btn--ghost" id="lock-tree-button" type="button">Lock</button>` : ""}
      </div>
    </header>
  `;
}

function renderSearchBox(filtered, selected) {
  const shouldShowResults = state.search.trim().length > 0;
  return `
    <div class="search-row">
      <label class="search">
        ${renderIcon("search")}
        <span class="sr-only">Search the family tree</span>
        <input id="search-input" type="search" value="${escapeHtml(state.search)}" placeholder="Search the family tree" autocomplete="off" />
      </label>
      ${
        shouldShowResults
          ? `
            <div class="search-results" role="listbox" aria-label="Search results">
              ${filtered.slice(0, 12).map((record) => renderSearchResult(record, selected?.id === record.id)).join("")}
              ${filtered.length > 12 ? `<p class="search-more">${filtered.length - 12} more matches - keep typing to narrow the list.</p>` : ""}
              ${!filtered.length ? `<p class="search-more">No family members match that name yet.</p>` : ""}
            </div>
          `
          : ""
      }
    </div>
  `;
}

function renderSearchResult(record, isSelected) {
  return `
    <button class="search-result ${isSelected ? "is-active" : ""}" type="button" data-select-id="${escapeHtml(record.id)}" role="option" aria-selected="${isSelected}">
      <span class="nm">${escapeHtml(record.name)}</span>
      <span class="meta">${escapeHtml(record.lifeSpan || "Dates not yet captured")}</span>
    </button>
  `;
}

function renderTreeTabs(activeView) {
  const views = [
    ["person", "radial", "Around this person"],
    ["patriarch", "tree", "Family tree"],
    ["generations", "list", "By generation"],
  ];

  return `
    <div class="tabs" role="tablist" aria-label="Tree view">
      ${views
        .map(
          ([value, icon, label]) => `
            <button class="tab ${activeView === value ? "is-active" : ""}" type="button" role="tab" aria-selected="${activeView === value}" data-tree-view="${escapeHtml(value)}">
              ${renderIcon(icon)} <span>${escapeHtml(label)}</span>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderRecentChips(recordMap) {
  const recent = state.recentlyViewed.map((id) => recordMap.get(id)).filter(Boolean).slice(0, 4);
  if (!recent.length) {
    return "";
  }

  return `
    <div class="breadcrumb">
      <span>Recently viewed:</span>
      ${recent
        .map((record) => `<button type="button" data-select-id="${escapeHtml(record.id)}">${escapeHtml(record.name)}</button>`)
        .join("")}
    </div>
  `;
}

function renderTreePanel(activeView, patriarch, selected, recordMap, payload) {
  const title = activeView === "generations" ? "Generations connected to" : "Centered on";
  const centeredPerson = activeView === "patriarch" ? patriarch : selected;

  return `
    <main class="panel tree-panel" aria-label="Family tree">
      <div class="panel-header">
        <div>
          <p class="panel-eyebrow">${escapeHtml(title)}</p>
          <h2 class="panel-title">${escapeHtml(centeredPerson.name)}</h2>
        </div>
        <a class="btn btn--sm" href="${escapeHtml(resolveContributionHref(payload, `Update for ${centeredPerson.name}`))}" rel="noreferrer">
          ${renderIcon("edit")} <span>Suggest an update</span>
        </a>
      </div>
      ${
        activeView === "person"
          ? renderPersonCenteredMap(selected, recordMap)
          : activeView === "generations"
            ? renderGenerationMap(selected, recordMap)
            : renderFamilyMindMap(patriarch, recordMap)
      }
    </main>
  `;
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

  state.steward = hydrateStoredSteward(state.steward);

  if (!state.steward?.name || (hasPublishingBridge(payload) && !state.steward?.code) || (!hasPublishingBridge(payload) && !state.steward?.token)) {
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
            <a class="hero-link hero-link-secondary" href="${escapeHtml(APP_BASE_URL.href)}">View tree</a>
            ${hasPublishingBridge(payload) ? "" : `<button class="hero-link hero-link-ghost" id="reset-publishing-token-button" type="button">Reset token</button>`}
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
          ${renderOnlinePersonForm(buildEmptyOnlineRecord(), payload, { formId: "online-new-person-form", submitLabel: "Create and publish", isNew: true })}
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
          <p class="lede">${hasPublishingBridge(payload) ? "Use your steward code to update the online tree." : "Use your steward code and publishing token to update the online tree."}</p>
        </div>
      </header>

      <section class="unlock-shell">
        <article class="unlock-card">
          <p class="feature-tag">Steward access</p>
          <h2>Sign in to manage records</h2>
          ${renderPublishingTokenHelp(payload)}
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
            ${renderPublishingTokenField()}
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
    const token = form.get("token")?.toString() || loadStoredPublishingToken();
    const isValid = await validateStewardCode(payload.stewardStudio.stewards, name, code);

    if (!isValid) {
      state.stewardError = "That steward name and code did not match.";
      renderStewardGate(payload);
      return;
    }

    if (hasPublishingBridge(payload)) {
      try {
        await validatePublishingBridge(payload, name, code);
        state.steward = { name, code };
        state.stewardError = "";
        window.localStorage.setItem(STEWARD_STORAGE_KEY, JSON.stringify(state.steward));
        renderStewardStudio(payload);
      } catch (error) {
        state.stewardError = error.message || "The family publishing bridge could not be reached.";
        renderStewardGate(payload);
      }
      return;
    }

    if (!token) {
      state.stewardError = "This device needs a publishing token once before it can save changes.";
      renderStewardGate(payload);
      return;
    }

    try {
      await validatePublishingToken(payload, token);
      state.steward = { name, token };
      state.stewardError = "";
      window.localStorage.setItem(STEWARD_TOKEN_STORAGE_KEY, token);
      window.localStorage.setItem(STEWARD_STORAGE_KEY, JSON.stringify(state.steward));
      renderStewardStudio(payload);
    } catch (error) {
      state.stewardError = error.message || "The publishing token could not be validated.";
      renderStewardGate(payload);
    }
  });
}

function renderPublishingTokenField() {
  if (state.payload && hasPublishingBridge(state.payload)) {
    return "";
  }

  if (loadStoredPublishingToken()) {
    return `
      <div class="saved-token-note">
        Publishing token saved on this device. Sign in with your steward name and code.
      </div>
    `;
  }

  return `
    <label>
      <span>Publishing token</span>
      <input type="password" name="token" autocomplete="off" placeholder="GitHub token for the Pages repo" required />
    </label>
  `;
}

function renderPublishingTokenHelp(payload) {
  const repo = payload.stewardStudio.repo;
  if (hasPublishingBridge(payload)) {
    return `
      <div class="token-help-card">
        <h3>Publishing is managed for stewards</h3>
        <p>The family publishing bridge keeps the GitHub token private, so stewards only need their steward name and code.</p>
      </div>
    `;
  }

  return `
    <div class="token-help-card">
      <h3>Need a publishing token?</h3>
      <p>The Studio cannot generate a GitHub token itself. GitHub must issue it from the account that owns or can edit the Pages repo.</p>
      <a class="token-help-link" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create a GitHub token</a>
      <dl>
        <div>
          <dt>Repository</dt>
          <dd>${escapeHtml(repo.owner)}/${escapeHtml(repo.name)}</dd>
        </div>
        <div>
          <dt>Permission</dt>
          <dd>Contents: Read and write</dd>
        </div>
        <div>
          <dt>After creating it</dt>
          <dd>Copy the token once, paste it below, then sign in. This browser will remember it.</dd>
        </div>
      </dl>
    </div>
  `;
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

  if (options.isNew) {
    return renderAddMemberWizard(payload, options);
  }

  return `
    <form id="${escapeHtml(options.formId)}" class="online-person-form" data-record-id="${escapeHtml(record.id || "")}">
      <div class="wizard-steps">
        <span>1. Details</span>
        <span>2. Family links</span>
        <span>3. Publish</span>
      </div>
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
      <div class="relationship-guide">
        <h3>Family links</h3>
        <p>Use parents for this person's mother/father or guardians. Use partners for spouses. Children linked here will also point back to this person as a parent.</p>
      </div>
      <div class="form-two-up">
        ${renderOnlineRelationshipSelect("Parents", "parentIds", relationships.parentIds, records, record.id)}
        ${renderOnlineRelationshipSelect("Partners", "spouseIds", relationships.spouseIds, records, record.id)}
      </div>
      ${renderOnlineRelationshipSelect("Children", "childIds", relationships.childIds, records, record.id)}
      ${renderLinkedPersonShortcut(record, records)}
      <button class="hero-link" type="submit" ${state.stewardSaving ? "disabled" : ""}>${state.stewardSaving ? "Publishing..." : escapeHtml(options.submitLabel)}</button>
    </form>
  `;
}

function renderAddMemberWizard(payload, options) {
  const records = [...payload.records].sort((left, right) => left.name.localeCompare(right.name));

  return `
    <form id="${escapeHtml(options.formId)}" class="online-person-form" data-record-id="">
      <div class="wizard-steps">
        <span>1. Who are we adding?</span>
        <span>2. How are they related?</span>
        <span>3. Publish</span>
      </div>
      <label>
        <span>New member name</span>
        <input type="text" name="name" placeholder="Example: Sarah Nyakana" required />
      </label>
      <div class="form-two-up">
        <label>
          <span>Life facts</span>
          <input type="text" name="lifeSpan" placeholder="Born 1994" />
        </label>
        <label>
          <span>Location</span>
          <input type="text" name="location" placeholder="Kampala, Uganda" />
        </label>
      </div>
      <label>
        <span>How should they be connected?</span>
        <select name="relationshipType" id="new-relationship-type">
          <option value="child">Child of two parents or one known parent</option>
          <option value="partner">Spouse / partner of an existing member</option>
          <option value="parent">Parent of an existing member</option>
          <option value="sibling">Sibling of an existing member</option>
          <option value="standalone">Not sure yet</option>
        </select>
      </label>
      <div class="relationship-builder" data-relationship-section="child">
        <div class="form-two-up">
          ${renderSingleRecordSelect("Parent 1", "parentOneId", records)}
          ${renderSingleRecordSelect("Parent 2", "parentTwoId", records)}
        </div>
      </div>
      <div class="relationship-builder is-hidden" data-relationship-section="partner">
        ${renderSingleRecordSelect("Existing spouse / partner", "partnerId", records)}
      </div>
      <div class="relationship-builder is-hidden" data-relationship-section="parent">
        ${renderSingleRecordSelect("Existing child", "childId", records)}
      </div>
      <div class="relationship-builder is-hidden" data-relationship-section="sibling">
        ${renderSingleRecordSelect("Existing sibling", "siblingId", records)}
      </div>
      <label>
        <span>Notes for the family view</span>
        <textarea name="summary" rows="3" placeholder="Optional context, story, or uncertainty."></textarea>
      </label>
      <input type="hidden" name="branch" value="Family branch" />
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

function renderSingleRecordSelect(label, name, records) {
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <select name="${escapeHtml(name)}">
        <option value="">Unknown / not listed yet</option>
        ${records.map((record) => `<option value="${escapeHtml(record.id)}">${escapeHtml(record.name)}</option>`).join("")}
      </select>
    </label>
  `;
}

function renderLinkedPersonShortcut(record, records) {
  return `
    <section class="linked-person-shortcut">
      <div>
        <p class="eyebrow">Optional shortcut</p>
        <h3>Add someone new and connect them to ${escapeHtml(record.name)}</h3>
        <p>If the person is not in the list yet, create them here while saving this record.</p>
      </div>
      <div class="form-two-up">
        <label>
          <span>New person's name</span>
          <input type="text" name="linkedPersonName" placeholder="Example: Sarah Nyakana" />
        </label>
        <label>
          <span>Relationship to ${escapeHtml(record.name)}</span>
          <select name="linkedRelationshipType" data-linked-relationship-type>
            <option value="">Do not add a new linked person</option>
            <option value="partner">Spouse / partner</option>
            <option value="child">Child</option>
            <option value="parent">Parent</option>
            <option value="sibling">Sibling</option>
          </select>
        </label>
      </div>
      <div class="form-two-up">
        <label>
          <span>Life facts</span>
          <input type="text" name="linkedPersonLifeSpan" placeholder="Born 1994" />
        </label>
        <label>
          <span>Location</span>
          <input type="text" name="linkedPersonLocation" placeholder="Kampala, Uganda" />
        </label>
      </div>
      <div class="linked-child-only is-hidden" data-linked-child-field>
        ${renderSingleRecordSelect("Other parent, if adding a child", "linkedSecondParentId", records.filter((candidate) => candidate.id !== record.id))}
      </div>
    </section>
  `;
}

function bindStewardStudioEvents(payload) {
  document.querySelector("#steward-logout-button")?.addEventListener("click", () => {
    state.steward = null;
    window.localStorage.removeItem(STEWARD_STORAGE_KEY);
    renderStewardStudio(payload);
  });

  document.querySelector("#reset-publishing-token-button")?.addEventListener("click", () => {
    state.steward = null;
    state.stewardMessage = "";
    state.stewardError = "";
    window.localStorage.removeItem(STEWARD_STORAGE_KEY);
    window.localStorage.removeItem(STEWARD_TOKEN_STORAGE_KEY);
    renderStewardStudio(payload);
  });

  document.querySelector("#new-relationship-type")?.addEventListener("change", (event) => {
    document.querySelectorAll("[data-relationship-section]").forEach((section) => {
      section.classList.toggle("is-hidden", section.dataset.relationshipSection !== event.currentTarget.value);
    });
  });

  document.querySelector("[data-linked-relationship-type]")?.addEventListener("change", (event) => {
    document.querySelector("[data-linked-child-field]")?.classList.toggle("is-hidden", event.currentTarget.value !== "child");
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
    applyGuidedRelationship(person, formData, nextPayload.records);

    if (!person.name) {
      throw new Error("A name is required before publishing.");
    }

    const existingIndex = nextPayload.records.findIndex((record) => record.id === person.id);
    if (existingIndex >= 0) {
      nextPayload.records[existingIndex] = { ...nextPayload.records[existingIndex], ...person };
    } else {
      nextPayload.records.push(person);
    }

    const linkedPerson = buildLinkedPersonForAnchor(person, formData, nextPayload.records);
    if (linkedPerson) {
      nextPayload.records.push(linkedPerson);
    }

    normalizePublishedRelationships(nextPayload.records);
    nextPayload.records.sort((left, right) => left.name.localeCompare(right.name));
    nextPayload.generatedAt = new Date().toISOString();
    nextPayload.publication.visibleRecordCount = nextPayload.records.length;

    await publishPayloadToGithub(nextPayload, person);
    state.payload = nextPayload;
    state.unlockedPayload = nextPayload;
    state.stewardSelectedId = linkedPerson?.id || person.id;
    state.stewardSearch = linkedPerson?.name || person.name;
    state.stewardMessage = linkedPerson
      ? `${person.name} and ${linkedPerson.name} were published to the online tree. GitHub Pages may take a minute to refresh.`
      : `${person.name} was published to the online tree. GitHub Pages may take a minute to refresh.`;
  } catch (error) {
    state.stewardError = error.message || "The record could not be published.";
  } finally {
    state.stewardSaving = false;
    renderStewardStudio(state.unlockedPayload || state.payload);
  }
}

function applyGuidedRelationship(person, formData, records) {
  const relationshipType = formData.get("relationshipType")?.toString() || "";
  if (!relationshipType) {
    return;
  }

  const recordMap = new Map(records.map((record) => [record.id, record]));
  const addIfKnown = (values) => values.map((value) => value?.toString()).filter((value) => value && recordMap.has(value));

  if (relationshipType === "child") {
    person.relationships.parentIds = addIfKnown([formData.get("parentOneId"), formData.get("parentTwoId")]);
  }

  if (relationshipType === "partner") {
    person.relationships.spouseIds = addIfKnown([formData.get("partnerId")]);
  }

  if (relationshipType === "parent") {
    person.relationships.childIds = addIfKnown([formData.get("childId")]);
  }

  if (relationshipType === "sibling") {
    const sibling = recordMap.get(formData.get("siblingId")?.toString() || "");
    person.relationships.parentIds = sibling?.relationships?.parentIds ? [...sibling.relationships.parentIds] : [];
  }
}

function buildLinkedPersonForAnchor(anchor, formData, records) {
  const linkedName = formData.get("linkedPersonName")?.toString().trim() || "";
  const relationshipType = formData.get("linkedRelationshipType")?.toString() || "";
  if (!linkedName && !relationshipType) {
    return null;
  }
  if (!linkedName || !relationshipType) {
    throw new Error("To add someone new from this record, enter their name and choose how they are related.");
  }

  const recordMap = new Map(records.map((record) => [record.id, record]));
  const secondParentId = formData.get("linkedSecondParentId")?.toString() || "";
  const linkedPersonId = `person_${window.crypto.randomUUID().slice(0, 10)}`;
  const parentIds = relationshipType === "child" ? [anchor.id, secondParentId].filter((id) => id && recordMap.has(id)) : [];
  const spouseIds = relationshipType === "partner" ? [anchor.id] : [];
  const siblingParents = relationshipType === "sibling" ? anchor.relationships?.parentIds || [] : [];
  if (relationshipType === "parent") {
    anchor.relationships.parentIds = unique([...(anchor.relationships.parentIds || []), linkedPersonId]);
  }

  const relationshipLabels = {
    partner: `Partner of ${anchor.name}`,
    child: `Child of ${anchor.name}`,
    parent: `Parent of ${anchor.name}`,
    sibling: `Sibling of ${anchor.name}`,
  };

  return {
    id: linkedPersonId,
    name: linkedName,
    lifeSpan: formData.get("linkedPersonLifeSpan")?.toString().trim() || "Dates not yet captured",
    location: formData.get("linkedPersonLocation")?.toString().trim() || "",
    branch: relationshipLabels[relationshipType] || "Family branch",
    summary: `${relationshipLabels[relationshipType] || "Connected"} in the Nyakana family tree.`,
    isDeceased: false,
    isPatriarch: false,
    visibility: anchor.visibility || "family-open",
    relationships: {
      parentIds: relationshipType === "sibling" ? [...siblingParents] : parentIds,
      spouseIds,
      childIds: [],
      siblingIds: [],
    },
  };
}

async function publishPayloadToGithub(payload, person) {
  if (hasPublishingBridge(payload)) {
    await publishPayloadToBridge(payload, person);
    return;
  }

  const repo = payload.stewardStudio.repo;
  const apiUrl = buildGithubContentUrl(repo);
  const headers = buildGithubHeaders(state.steward.token);
  const current = await fetch(`${apiUrl}?ref=${encodeURIComponent(repo.branch)}`, { headers }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(formatGithubTokenError(response.status, body.message || "Could not read the current published tree from GitHub."));
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
    throw new Error(formatGithubTokenError(response.status, body.message || "GitHub did not accept the published tree update."));
  }
}

async function publishPayloadToBridge(payload, person) {
  const response = await fetch(payload.stewardStudio.publishEndpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: "publish",
      stewardName: state.steward.name,
      stewardCode: state.steward.code,
      message: `Update family tree record: ${person.name}`,
      payload,
      person: { id: person.id, name: person.name },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || "The family publishing bridge could not publish the tree.");
  }
}

async function validatePublishingBridge(payload, stewardName, stewardCode) {
  const response = await fetch(payload.stewardStudio.publishEndpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: "validate",
      stewardName,
      stewardCode,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || "The family publishing bridge did not accept that steward code.");
  }
}

async function validatePublishingToken(payload, token) {
  const repo = payload.stewardStudio.repo;
  const apiUrl = buildGithubContentUrl(repo);
  const response = await fetch(`${apiUrl}?ref=${encodeURIComponent(repo.branch)}`, { headers: buildGithubHeaders(token) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(formatGithubTokenError(response.status, body.message || "The publishing token could not read the tree file."));
  }
}

function buildGithubContentUrl(repo) {
  return `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${repo.dataPath}`;
}

function buildGithubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function formatGithubTokenError(status, fallbackMessage) {
  if (status === 401) {
    return "GitHub rejected the saved publishing token. Use Reset token, then sign in again with a fresh GitHub token that has Contents read/write access to nyacly/nyakana-family-tree.";
  }

  if (status === 403) {
    return "GitHub accepted the token but it does not have permission to publish this tree. Create or update the token with Contents read/write access to nyacly/nyakana-family-tree.";
  }

  return fallbackMessage;
}

function hasPublishingBridge(payload) {
  return Boolean(payload?.stewardStudio?.publishEndpoint);
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
  const summary = cleanFamilyCopy(record.summary) || buildFamilySummary(record, { parents, partners, children, siblings });

  return `
    <aside class="panel side-rail detail" aria-label="Family record">
      <div class="detail-head">
        <div>
          <p class="panel-eyebrow">Family record</p>
          <h2 class="panel-title">${escapeHtml(record.name)}</h2>
        </div>
        <a class="icon-btn" href="${escapeHtml(resolveContributionHref(payload, `Update for ${record.name}`))}" rel="noreferrer" aria-label="Suggest an update for ${escapeHtml(record.name)}">
          ${renderIcon("edit")}
        </a>
      </div>

      ${summary ? `<p class="summary-line">${escapeHtml(summary)}</p>` : ""}

      <div class="facts">
        <span class="fact-chip">${escapeHtml(record.lifeSpan || "Dates not yet captured")}</span>
        ${record.location && !/not yet captured/iu.test(record.location) ? `<span class="fact-chip">${escapeHtml(record.location)}</span>` : ""}
        ${record.isDeceased ? `<span class="fact-chip">Remembered</span>` : ""}
      </div>

      <div class="relations">
        ${renderRelationshipGroup("Parents", parents)}
        ${renderRelationshipGroup("Partners", partners)}
        ${renderRelationshipGroup("Children", children)}
        ${renderRelationshipGroup("Siblings", siblings)}
      </div>

      <div class="detail-cta">
        <a class="btn btn--primary" href="${escapeHtml(resolveContributionHref(payload, `Update for ${record.name}`))}" rel="noreferrer">
          ${renderIcon("edit")} <span>Update this record</span>
        </a>
      </div>
    </aside>
  `;
}

function renderRelationshipGroup(label, people) {
  if (!people.length) {
    return "";
  }

  return `
    <section class="relations-block">
      <div class="relations-block-head">
        <h3>${escapeHtml(label)}</h3>
        <span class="count">${people.length}</span>
      </div>
      <div class="relationship-list">
        ${people
          .map(
            (person) => `
              <button class="relation-item" type="button" data-select-id="${escapeHtml(person.id)}">
                <span class="l">
                  <span class="nm">${escapeHtml(person.name)}</span>
                  <span class="sub">${escapeHtml(person.lifeSpan || "Dates not yet captured")}</span>
                </span>
                ${renderIcon("chevron")}
              </button>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderFamilyMindMap(patriarch, recordMap) {
  const partners = resolvePeople(patriarch.relationships.spouseIds, recordMap);
  const children = resolvePeople(patriarch.relationships.childIds, recordMap);

  return `
    <div class="tree-radial tree-radial-family">
      <div class="tree-row">
        <div class="tree-focus-wrap">
          ${renderMindMapNode(patriarch, patriarch.isPatriarch ? "Patriarch" : "Centered on", { featured: true })}
          ${partners.length ? `<div class="tree-cards tree-cards-partners">${partners.map((person) => renderMindMapNode(person, "Partner")).join("")}</div>` : ""}
        </div>
      </div>

      ${children.length ? renderTreeCardRow("Children", children, "Child", { count: true }) : ""}
    </div>
  `;
}

function renderPersonCenteredMap(person, recordMap) {
  const parents = resolvePeople(person.relationships.parentIds, recordMap);
  const partners = resolvePeople(person.relationships.spouseIds, recordMap);
  const siblings = resolvePeople(person.relationships.siblingIds, recordMap);
  const children = resolvePeople(person.relationships.childIds, recordMap);

  return `
    <div class="tree-radial">
      ${parents.length ? renderTreeCardRow("Parents", parents, "Parent") : ""}

      <div class="tree-row">
        ${parents.length ? `<div class="tree-connector"></div>` : ""}
        <div class="tree-focus-wrap">
          ${renderMindMapNode(person, person.isPatriarch ? "Patriarch" : "Centered on", { featured: true })}
          ${partners.length ? `<div class="tree-cards tree-cards-partners">${partners.map((partner) => renderMindMapNode(partner, "Partner")).join("")}</div>` : ""}
        </div>
      </div>

      ${siblings.length ? renderTreeCardRow("Siblings", siblings, "Sibling") : ""}
      ${children.length ? renderTreeCardRow("Children", children, "Child", { count: true, connector: true }) : ""}
      ${!parents.length && !partners.length && !children.length && !siblings.length ? `<p class="tree-empty">No connections recorded yet for ${escapeHtml(person.name)}.</p>` : ""}
    </div>
  `;
}

function renderGenerationMap(root, recordMap) {
  const groups = buildGenerationGroups(root, recordMap);
  return `
    <div class="gen-list">
      ${groups.map((group) => renderGenerationGroup(group)).join("")}
    </div>
  `;
}

function renderGenerationGroup(group) {
  if (!group.people.length) {
    return "";
  }

  return `
    <section class="gen-group">
      <h3>${escapeHtml(group.label)}</h3>
      <div class="gen-sub">${group.people.length} ${group.people.length === 1 ? "person" : "people"}</div>
      <div class="gen-cards">
        ${group.people.map((person) => renderMindMapNode(person, group.role, { compact: group.compact })).join("")}
      </div>
    </section>
  `;
}

function buildGenerationGroups(root, recordMap) {
  const parents = resolvePeople(root.relationships.parentIds, recordMap);
  const partners = resolvePeople(root.relationships.spouseIds, recordMap);
  const children = resolvePeople(root.relationships.childIds, recordMap);
  const grandchildren = unique(children.flatMap((child) => child.relationships.childIds || [])).map((id) => recordMap.get(id)).filter(Boolean);
  const greatGrandchildren = unique(grandchildren.flatMap((child) => child.relationships.childIds || [])).map((id) => recordMap.get(id)).filter(Boolean);

  return [
    { label: "Parents", role: "Parent", people: parents, compact: true },
    { label: "This generation", role: root.isPatriarch ? "Patriarch" : "Selected", people: [root] },
    { label: "Partners", role: "Partner", people: partners, compact: true },
    { label: "Children", role: "Child", people: children },
    { label: "Grandchildren", role: "Grandchild", people: grandchildren, compact: true },
    { label: "Great-grandchildren", role: "Great-grandchild", people: greatGrandchildren, compact: true },
  ];
}

function renderChildBranch(child, recordMap) {
  const grandchildren = resolvePeople(child.relationships.childIds, recordMap);
  return `
    <article class="mind-map-branch">
      ${renderMindMapNode(child, "Child")}
      ${
        grandchildren.length
          ? `
            <div class="mind-map-grandchildren">
              ${grandchildren.map((person) => renderMindMapNode(person, "Grandchild", { compact: true })).join("")}
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderTreeCardRow(label, people, role, options = {}) {
  return `
    <div class="tree-row">
      ${options.connector ? `<div class="tree-connector"></div>` : ""}
      <span class="tree-label">${escapeHtml(label)}${options.count ? ` (${people.length})` : ""}</span>
      <div class="tree-cards">
        ${people.map((person) => renderMindMapNode(person, role)).join("")}
      </div>
    </div>
  `;
}

function renderMindMapNode(person, role, options = {}) {
  const classes = ["pcard"];
  if (options.featured) {
    classes.push("is-focus");
  }
  if (person.isDeceased) {
    classes.push("is-deceased");
  }
  if (options.compact) {
    classes.push("is-compact");
  }

  return `
    <button class="${classes.join(" ")}" type="button" data-select-id="${escapeHtml(person.id)}">
      <span class="pcard-role">${escapeHtml(role)}</span>
      <span class="pcard-name">${escapeHtml(person.name)}</span>
      ${options.compact ? "" : `<span class="pcard-meta">${escapeHtml(person.lifeSpan || "Dates not yet captured")}</span>`}
    </button>
  `;
}

function normalizeTreeView(value) {
  if (["person", "patriarch", "generations"].includes(value)) {
    return value;
  }

  if (value === "vertical") {
    return "patriarch";
  }

  if (value === "list") {
    return "generations";
  }

  return "person";
}

function cleanFamilyCopy(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  return text
    .split(".")
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => !/(heritage|gedcom|import|private full-tree|prototype|privacy rules|visible only)/iu.test(sentence))
    .map((sentence) => `${sentence}.`)
    .join(" ")
    .trim();
}

function buildFamilySummary(record, groups) {
  const parts = [];

  if (groups.parents.length) {
    parts.push(`Child of ${formatNameList(groups.parents)}.`);
  }
  if (groups.partners.length) {
    parts.push(`Connected to ${formatNameList(groups.partners)}.`);
  }
  if (groups.children.length) {
    parts.push(`${groups.children.length} linked ${groups.children.length === 1 ? "child" : "children"}.`);
  }
  if (!parts.length && record.branch) {
    parts.push(cleanFamilyCopy(record.branch));
  }

  return parts.filter(Boolean).join(" ");
}

function formatNameList(people) {
  const names = people.map((person) => person.name);
  if (names.length <= 2) {
    return names.join(" and ");
  }

  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function renderIcon(name) {
  const icons = {
    chevron: `<path d="m9 6 6 6-6 6" />`,
    edit: `<path d="M4 20h4l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" />`,
    link: `<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1" />`,
    list: `<path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" />`,
    plus: `<path d="M12 5v14" /><path d="M5 12h14" />`,
    radial: `<circle cx="12" cy="12" r="2" /><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 8.2 10.3 10" /><path d="m13.7 10 2.3-1.8" /><path d="m8 15.8 2.3-1.8" /><path d="m13.7 14 2.3 1.8" />`,
    search: `<circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />`,
    tree: `<path d="M12 4v16" /><path d="M12 8H7v5" /><path d="M12 8h5v5" /><path d="M7 18h10" />`,
  };

  return `
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      ${icons[name] || icons.chevron}
    </svg>
  `;
}

function renderEmptyState(payload) {
  return `
    <article class="panel">
      <div class="empty-card">
        <p class="panel-eyebrow">${escapeHtml(payload.site.treeLabel || "Family branch")}</p>
        <h2>No records are available yet</h2>
        <p>The steward team has not published this branch yet.</p>
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
      const nextId = button.dataset.selectId || "";
      if (state.selectedId && state.selectedId !== nextId) {
        state.recentlyViewed = [state.selectedId, ...state.recentlyViewed.filter((id) => id !== state.selectedId && id !== nextId)].slice(0, 6);
      }
      state.selectedId = nextId;
      const params = new URLSearchParams(window.location.search);
      params.set("person", state.selectedId);
      window.history.replaceState({}, "", `${window.location.pathname}?${params}`);
      state.search = "";
      renderTreeView(payload);
    });
  });

  document.querySelectorAll("[data-tree-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.treeView = normalizeTreeView(button.dataset.treeView || "person");
      window.localStorage.setItem(TREE_VIEW_STORAGE_KEY, state.treeView);
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

function hydrateStoredSteward(steward) {
  if (!steward?.name) {
    return steward;
  }

  return {
    ...steward,
    token: steward.token || loadStoredPublishingToken(),
  };
}

function loadStoredPublishingToken() {
  return window.localStorage.getItem(STEWARD_TOKEN_STORAGE_KEY) || "";
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
