const appRoot = document.querySelector("#app");
const ACCESS_STORAGE_KEY = "nyakana-family-tree-access-code";

const state = {
  payload: null,
  unlockedPayload: null,
  selectedId: "",
  search: "",
  accessCode: "",
  error: "",
  unlockError: "",
  unlocking: false,
};

await init();

async function init() {
  try {
    state.payload = await fetch("./data/tree.json", { cache: "no-store" }).then((response) => {
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
            <a class="hero-link" href="${buildMailto(payload.site.contactEmail, "Suggest a correction")}" rel="noreferrer">Suggest a correction</a>
            <a class="hero-link hero-link-secondary" href="${buildMailto(payload.site.contactEmail, "Add my family branch")}" rel="noreferrer">Add your branch</a>
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
        <p>The steward team updates the master archive offline and republishes the protected family tree after approved changes.</p>
        <a class="hero-link" href="${buildMailto(payload.site.contactEmail, `Update for ${record.name}`)}" rel="noreferrer">Send an update for ${escapeHtml(record.name)}</a>
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
