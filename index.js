/**
 * @name ROSE-CustomWheel
 * @description Custom mod flyout reusing the ChromaWheel look
 */
console.log("[ROSE-CustomWheel] Plugin loaded");
(function createCustomWheelChromaStyle() {
  const LOG_PREFIX = "[ROSE-CustomWheel]";
  const BUTTON_CLASS = "lu-chroma-button";
  const PANEL_ID = "rose-custom-wheel-panel";
  const ENTRY_LIST_ID = "rose-custom-wheel-list";
  const LOADING_ID = "rose-custom-wheel-loading";
  const REQUEST_TYPE = "request-skin-mods";
  const OPEN_FOLDER_TYPE = "open-mods-folder";
  const EVENT_SKIN_STATE = "lu-skin-monitor-state";
  const EVENT_MODS_RESPONSE = "rose-custom-wheel-skin-mods";
  const EVENT_LOCK_STATE = "rose-custom-wheel-champion-locked";
  let emitRetryCount = 0;
  let isOpen = false;
  let panel, button, loadingEl, listEl;
  let championSelectRoot = null;
  let championSelectObserver = null;
  let championLocked = false;

  function emit(payload) {
    const emitter = window?.__roseBridgeEmit;
    if (typeof emitter !== "function") {
      if (emitRetryCount < 60) {
        emitRetryCount += 1;
        setTimeout(() => emit(payload), 200);
      } else {
        console.warn(`${LOG_PREFIX} Bridge emitter unavailable`);
      }
      return;
    }
    emitRetryCount = 0;
    emitter(payload);
  }

  function formatTimestamp(ms) {
    if (!ms) {
      return "";
    }
    try {
      return new Date(ms).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function createButton() {
    if (button) {
      return button;
    }
    button = document.createElement("div");
    button.className = BUTTON_CLASS;
    button.innerHTML = `
      <div class="outer-mask interactive">
        <div class="frame-color">
          <div class="content"></div>
          <div class="inner-mask inner-shadow"></div>
        </div>
      </div>
    `;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      isOpen ? closePanel() : openPanel();
    });
    return button;
  }

  function createPanel() {
    if (panel) {
      return panel;
    }
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "lu-chroma-panel";
    panel.innerHTML = `
      <div class="chroma-modal">
        <div class="chroma-information">
          <div class="chroma-information-image"></div>
          <div class="child-skin-name">Custom mods</div>
        </div>
        <div class="chroma-selection">
          <button class="rose-custom-wheel-open-folder">Open folder</button>
        </div>
        <div class="rcw-loading" id="${LOADING_ID}">Waiting for mods…</div>
        <ul class="rcw-mod-list" id="${ENTRY_LIST_ID}"></ul>
      </div>
    `;
    listEl = panel.querySelector(`#${ENTRY_LIST_ID}`);
    loadingEl = panel.querySelector(`#${LOADING_ID}`);
    panel
      .querySelector(".rose-custom-wheel-open-folder")
      .addEventListener("click", () => {
        emit({ type: OPEN_FOLDER_TYPE });
      });
    return panel;
  }

  function attachToChampionSelect() {
    if (!championSelectRoot || !championLocked) {
      return;
    }
    createButton();
    createPanel();
    if (button.parentNode !== championSelectRoot) {
      championSelectRoot.appendChild(button);
    }
    if (panel.parentNode !== championSelectRoot) {
      championSelectRoot.appendChild(panel);
    }
  }

  function detachFromChampionSelect() {
    if (button && button.parentNode) {
      button.parentNode.removeChild(button);
    }
    if (panel && panel.parentNode) {
      panel.parentNode.removeChild(panel);
    }
  }

  function refreshUIVisibility() {
    if (championLocked && championSelectRoot) {
      attachToChampionSelect();
      return;
    }
    closePanel();
    detachFromChampionSelect();
  }

  function updateChampionSelectTarget() {
    const target = document.querySelector(".champion-select");
    if (target === championSelectRoot) {
      return;
    }
    championSelectRoot = target;
    refreshUIVisibility();
  }

  function observeChampionSelect() {
    if (championSelectObserver || !document.body) {
      return;
    }
    championSelectObserver = new MutationObserver(() => {
      updateChampionSelectTarget();
    });
    championSelectObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function positionPanel() {
    if (!panel || !button) {
      return;
    }
    const rect = button.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const left = rect.right + 16;
    const top = rect.top - panelRect.height / 2 + rect.height / 2;
    panel.style.position = "fixed";
    panel.style.top = `${Math.max(
      12,
      Math.min(window.innerHeight - panelRect.height - 12, top)
    )}px`;
    panel.style.left = `${Math.min(
      Math.max(12, left),
      window.innerWidth - panelRect.width - 12
    )}px`;
  }

  function updateEntries(mods) {
    if (!listEl || !loadingEl) {
      return;
    }
    listEl.innerHTML = "";
    if (!mods.length) {
      loadingEl.textContent = "No mods";
      loadingEl.style.display = "block";
      return;
    }
    loadingEl.style.display = "none";
    mods.forEach((mod) => {
      const entry = document.createElement("li");
      entry.className = "rcw-mod-entry";
      const name = document.createElement("span");
      name.className = "rcw-mod-name";
      name.textContent = mod.modName || "Unnamed mod";
      entry.appendChild(name);
      if (mod.description) {
        const desc = document.createElement("span");
        desc.className = "rcw-mod-description";
        desc.textContent = mod.description;
        entry.appendChild(desc);
      }
      const meta = document.createElement("span");
      meta.className = "rcw-mod-meta";
      const parts = [];
      if (mod.relativePath) {
        parts.push(mod.relativePath);
      }
      if (mod.updatedAt) {
        parts.push(formatTimestamp(mod.updatedAt));
      }
      meta.textContent = parts.join(" • ");
      entry.appendChild(meta);
      listEl.appendChild(entry);
    });
  }

  function openPanel() {
    if (!championLocked) {
      console.log(`${LOG_PREFIX} Cannot open wheel while champion is unlocked`);
      return;
    }
    if (!championSelectRoot) {
      console.log(
        `${LOG_PREFIX} Champion select UI unavailable; cannot open wheel`
      );
      return;
    }
    attachToChampionSelect();
    positionPanel();
    panel.classList.add("visible");
    panel.style.pointerEvents = "auto";
    isOpen = true;
    requestModsForCurrentSkin();
  }

  function closePanel() {
    if (!panel) {
      return;
    }
    panel.classList.remove("visible");
    panel.style.pointerEvents = "none";
    isOpen = false;
  }

  function requestModsForCurrentSkin() {
    const state = window.__roseSkinState || {};
    const championId = Number(state.championId);
    const skinId = Number(state.skinId);
    if (!championId || !skinId) {
      console.log(
        `${LOG_PREFIX} No skin detected yet (championId=${championId}, skinId=${skinId}); waiting for hover.`
      );
      loadingEl && (loadingEl.textContent = "Hover a skin...");
      return;
    }
    console.log(`${LOG_PREFIX} Requesting mods for ${championId}:${skinId}`);
    emit({ type: REQUEST_TYPE, championId, skinId });
    loadingEl &&
      ((loadingEl.textContent = "Checking for mods…"),
      (loadingEl.style.display = "block"));
  }

  function handleSkinState(event) {
    if (!isOpen) {
      return;
    }
    requestModsForCurrentSkin();
  }

  function handleModsResponse(event) {
    if (!isOpen) {
      return;
    }
    const detail = event?.detail;
    if (!detail || detail.type !== "skin-mods-response") {
      return;
    }
    const championId = Number(detail?.championId);
    const skinId = Number(detail?.skinId);
    if (!championId || !skinId) {
      console.log(
        `${LOG_PREFIX} Ignoring skin mods response without valid ids`
      );
      return;
    }
    const mods = Array.isArray(detail.mods) ? detail.mods : [];
    console.log(
      `${LOG_PREFIX} Received skins response for championId=${championId}, skinId=${skinId} (${mods.length} mod(s))`
    );
    updateEntries(mods);
  }

  function handleChampionLocked(event) {
    const locked = Boolean(event?.detail?.locked);
    if (locked === championLocked) {
      return;
    }
    championLocked = locked;
    console.log(`${LOG_PREFIX} Champion locked state: ${championLocked}`);
    refreshUIVisibility();
  }

  function insertStyles() {
    if (document.getElementById("rose-custom-wheel-style")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "rose-custom-wheel-style";
    style.textContent = `
      .${BUTTON_CLASS} {
        position: fixed;
        top: 32px;
        right: 34px;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        cursor: pointer;
        z-index: 99998;
        filter: drop-shadow(0 0 12px rgba(0, 0, 0, 0.55));
      }
      .${BUTTON_CLASS} .frame-color {
        border-radius: 50%;
        background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.7), transparent 60%), #1f2229;
        height: 100%;
        width: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .${BUTTON_CLASS} .content {
        width: 16px;
        height: 16px;
        background: url(/fe/lol-champ-select/images/config/button-chroma.png) no-repeat center;
        background-size: contain;
      }
      #${PANEL_ID} {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 99999;
        pointer-events: none;
        opacity: 0;
        transform: translateY(-12px);
        transition: opacity 0.18s ease, transform 0.18s ease;
      }
      #${PANEL_ID}.visible {
        opacity: 1;
        pointer-events: all;
        transform: translateY(0);
      }
      #${PANEL_ID} .chroma-modal {
        width: 300px;
        padding: 16px;
        border-radius: 20px;
        background: linear-gradient(180deg, rgba(9, 10, 18, 0.95), rgba(13, 15, 24, 0.95));
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.65);
        font-family: "Segoe UI", system-ui, sans-serif;
        color: #f7f8ff;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      #${PANEL_ID} .chroma-information {
        padding: 8px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.05);
        background: rgba(255, 255, 255, 0.02);
        margin-bottom: 8px;
      }
      #${PANEL_ID} .chroma-selection {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
      }
      .rose-custom-wheel-open-folder {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.28);
        border-radius: 999px;
        padding: 4px 10px;
        color: #fff;
        font-size: 10px;
        letter-spacing: 1px;
        cursor: pointer;
        transition: transform 0.15s ease;
      }
      .rose-custom-wheel-open-folder:hover {
        transform: translateY(-1px);
      }
      .rcw-loading {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.6);
      }
      .rcw-mod-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 210px;
        overflow-y: auto;
      }
      .rcw-mod-entry {
        border-radius: 10px;
        padding: 8px 10px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .rcw-mod-name {
        font-weight: 600;
      }
      .rcw-mod-description,
      .rcw-mod-meta {
        font-size: 10px;
        color: rgba(255, 255, 255, 0.6);
      }
      .rcw-mod-meta {
        font-style: italic;
      }
    `;
    document.head.appendChild(style);
  }

  function whenReady(cb) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", cb, { once: true });
      return;
    }
    cb();
  }

  whenReady(() => {
    insertStyles();
    createButton();
    createPanel();
    updateChampionSelectTarget();
    observeChampionSelect();
    window.addEventListener(EVENT_SKIN_STATE, handleSkinState, { passive: true });
    window.addEventListener(EVENT_MODS_RESPONSE, handleModsResponse, {
      passive: true,
    });
    window.addEventListener(EVENT_LOCK_STATE, handleChampionLocked, {
      passive: true,
    });
    window.addEventListener("resize", positionPanel, { passive: true });
    window.addEventListener("scroll", positionPanel, { passive: true });
  });
})();

