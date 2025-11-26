/**
 * @name ROSE-CustomWheel
 * @author Rose Team
 * @description Displays custom mod metadata for hovered champion skins
 * @link https://github.com/Alban1911/ROSE-CustomWheel
 */
(function createCustomWheelPanel() {
  const LOG_PREFIX = "[Rose-CustomWheel]";
  const PANEL_ID = "rose-custom-wheel-panel";
  const LOADING_TEXT_ID = "rose-custom-wheel-loading";
  const MOD_LIST_ID = "rose-custom-wheel-list";
  const HEADER_COUNT_ID = "rose-custom-wheel-count";
  const EVENT_SKIN_STATE = "lu-skin-monitor-state";
  const EVENT_MODS_RESPONSE = "rose-custom-wheel-skin-mods";
  const REQUEST_TYPE = "request-skin-mods";
  const OPEN_FOLDER_TYPE = "open-mods-folder";
  const MAX_EMIT_RETRIES = 60;

  let lastSkinKey = null;
  let panel = null;
  let emitRetryCount = 0;

  function encodeHtml(value) {
    if (!value) {
      return "";
    }
    const span = document.createElement("span");
    span.textContent = value;
    return span.innerHTML;
  }

  function formatTimestamp(ms) {
    if (!ms) {
      return "";
    }
    try {
      const date = new Date(ms);
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  function emitToBridge(payload) {
    const emitter = window.__roseBridgeEmit;
    if (typeof emitter !== "function") {
      if (emitRetryCount < MAX_EMIT_RETRIES) {
        emitRetryCount += 1;
        setTimeout(() => emitToBridge(payload), 250);
      } else {
        console.warn(`${LOG_PREFIX} Bridge emitter unavailable`);
      }
      return;
    }

    emitRetryCount = 0;
    emitter(payload);
  }

  function ensurePanel() {
    if (panel) {
      return panel;
    }

    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "rose-custom-wheel-panel rcw-hidden";
    panel.innerHTML = `
      <div class="rcw-panel-header">
        <div class="rcw-title">Custom mods</div>
        <button class="rcw-open-folder" type="button" aria-label="Open mods folder">Open</button>
      </div>
      <div class="rcw-loading" id="${LOADING_TEXT_ID}">Checking for mods…</div>
      <ul class="rcw-mod-list" id="${MOD_LIST_ID}"></ul>
    `;

    const openButton = panel.querySelector(".rcw-open-folder");
    openButton.addEventListener("click", () => {
      emitToBridge({ type: OPEN_FOLDER_TYPE });
    });

    document.body.appendChild(panel);
    return panel;
  }

  function showLoading() {
    const panelEl = ensurePanel();
    const loadingEl = panelEl.querySelector(`#${LOADING_TEXT_ID}`);
    const listEl = panelEl.querySelector(`#${MOD_LIST_ID}`);
    loadingEl.style.display = "block";
    listEl.innerHTML = "";
    panelEl.classList.remove("rcw-hidden");
  }

  function hidePanel() {
    if (!panel) {
      return;
    }
    panel.classList.add("rcw-hidden");
  }

  function renderMods(mods) {
    if (!panel) {
      return;
    }

    const listEl = panel.querySelector(`#${MOD_LIST_ID}`);
    const loadingEl = panel.querySelector(`#${LOADING_TEXT_ID}`);
    const countEl = panel.querySelector(`#${HEADER_COUNT_ID}`);

    loadingEl.style.display = "none";
    listEl.innerHTML = mods
      .map((mod) => {
        const name = encodeHtml(mod.modName || "Unnamed mod");
        const description = encodeHtml(mod.description || "");
        const path = encodeHtml(mod.relativePath || "");
        const timestamp = formatTimestamp(mod.updatedAt);
        const metaParts = [];
        if (path) {
          metaParts.push(path);
        }
        if (timestamp) {
          metaParts.push(timestamp);
        }
        const meta = metaParts.join(" • ");

        return `
          <li class="rcw-mod-entry">
            <span class="rcw-mod-name">${name}</span>
            ${description ? `<span class="rcw-mod-description">${description}</span>` : ""}
            ${meta ? `<span class="rcw-mod-meta">${meta}</span>` : ""}
          </li>
        `;
      })
      .join("");

    panel.classList.remove("rcw-hidden");
  }

  function handleSkinState(event) {
    const detail = event?.detail || {};
    const championId = Number(detail?.championId);
    const skinId = Number(detail?.skinId);
    if (!championId || !skinId) {
      lastSkinKey = null;
      hidePanel();
      return;
    }

    const key = `${championId}:${skinId}`;
    if (key === lastSkinKey) {
      return;
    }

    lastSkinKey = key;
    showLoading();
    emitToBridge({ type: REQUEST_TYPE, championId, skinId });
  }

  function handleModsResponse(event) {
    const detail = event?.detail || {};
    if (detail?.type !== "skin-mods-response") {
      return;
    }

    const championId = Number(detail?.championId);
    const skinId = Number(detail?.skinId);
    if (!championId || !skinId) {
      return;
    }

    const key = `${championId}:${skinId}`;
    if (key !== lastSkinKey) {
      return;
    }

    const mods = Array.isArray(detail.mods) ? detail.mods : [];
    if (!mods.length) {
      hidePanel();
      return;
    }

    renderMods(mods);
  }

  function insertStyles() {
    if (document.getElementById("rose-custom-wheel-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "rose-custom-wheel-style";
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 20px;
        bottom: 180px;
        width: 260px;
        max-height: 260px;
        padding: 10px;
        border-radius: 12px;
        background: rgba(17, 17, 20, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.65);
        color: #f5f5f5;
        font-size: 12px;
        font-family: "Segoe UI", system-ui, sans-serif;
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: 99999;
      }

      #${PANEL_ID}.rcw-hidden {
        display: none !important;
      }

      #${PANEL_ID} .rcw-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 6px;
      }

      #${PANEL_ID} .rcw-title {
        font-weight: 700;
        font-size: 13px;
      }

      #${PANEL_ID} .rcw-open-folder {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: inherit;
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 10px;
        cursor: pointer;
        transition: background 0.2s ease;
      }

      #${PANEL_ID} .rcw-open-folder:hover {
        background: rgba(255, 255, 255, 0.12);
      }

      #${PANEL_ID} .rcw-loading {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.65);
      }

      #${PANEL_ID} .rcw-mod-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
        overflow-y: auto;
        max-height: 190px;
      }

      #${PANEL_ID} .rcw-mod-entry {
        border-radius: 8px;
        padding: 6px 8px;
        background: rgba(255, 255, 255, 0.04);
      }

      #${PANEL_ID} .rcw-mod-name {
        display: block;
        font-weight: 600;
        font-size: 12px;
      }

      #${PANEL_ID} .rcw-mod-description,
      #${PANEL_ID} .rcw-mod-meta {
        display: block;
        font-size: 10px;
        color: rgba(255, 255, 255, 0.7);
      }
    `;
    document.head.appendChild(style);
  }

  function whenReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
      return;
    }
    callback();
  }

  whenReady(() => {
    insertStyles();
    ensurePanel();
    window.addEventListener(EVENT_SKIN_STATE, handleSkinState, { passive: true });
    window.addEventListener(EVENT_MODS_RESPONSE, handleModsResponse, {
      passive: true,
    });
  });
})();

