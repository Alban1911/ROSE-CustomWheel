/**
 * @name ROSE-CustomWheel
 * @author Rose Team
 * @description Custom mod wheel for Pengu Loader - displays installed mods for hovered skins
 * @link https://github.com/Alban1911/ROSE-CustomWheel
 */
(function createCustomWheel() {
  const LOG_PREFIX = "[ROSE-CustomWheel]";
  const BUTTON_CLASS = "lu-chroma-button";
  const BUTTON_SELECTOR = `.${BUTTON_CLASS}`;
  const PANEL_CLASS = "lu-chroma-panel";
  const PANEL_ID = "rose-custom-wheel-panel-container";
  const REQUEST_TYPE = "request-skin-mods";
  const OPEN_FOLDER_TYPE = "open-mods-folder";
  const EVENT_SKIN_STATE = "lu-skin-monitor-state";
  const EVENT_MODS_RESPONSE = "rose-custom-wheel-skin-mods";
  const EVENT_LOCK_STATE = "rose-custom-wheel-champion-locked";

  let emitRetryCount = 0;
  let isOpen = false;
  let panel = null;
  let button = null;
  let championSelectRoot = null;
  let championSelectObserver = null;
  let championLocked = false;
  let currentSkinData = null;

  // WebSocket bridge for communication
  let BRIDGE_PORT = 50000;
  let BRIDGE_URL = `ws://localhost:${BRIDGE_PORT}`;
  const BRIDGE_PORT_STORAGE_KEY = "rose_bridge_port";
  const DISCOVERY_START_PORT = 50000;
  const DISCOVERY_END_PORT = 50010;
  let bridgeSocket = null;
  let bridgeReady = false;
  let bridgeQueue = [];

  // Load bridge port with file-based discovery and localStorage caching
  async function loadBridgePort() {
    try {
      const cachedPort = localStorage.getItem(BRIDGE_PORT_STORAGE_KEY);
      if (cachedPort) {
        const port = parseInt(cachedPort, 10);
        if (!isNaN(port) && port > 0) {
          try {
            const response = await fetch(`http://localhost:${port}/bridge-port`, {
              signal: AbortSignal.timeout(1000),
            });
            if (response.ok) {
              const portText = await response.text();
              const fetchedPort = parseInt(portText.trim(), 10);
              if (!isNaN(fetchedPort) && fetchedPort > 0) {
                BRIDGE_PORT = fetchedPort;
                BRIDGE_URL = `ws://localhost:${BRIDGE_PORT}`;
                return true;
              }
            }
          } catch (e) {
            localStorage.removeItem(BRIDGE_PORT_STORAGE_KEY);
          }
        }
      }

      for (let port = DISCOVERY_START_PORT; port <= DISCOVERY_END_PORT; port++) {
        try {
          const response = await fetch(`http://localhost:${port}/bridge-port`, {
            signal: AbortSignal.timeout(1000),
          });
          if (response.ok) {
            const portText = await response.text();
            const fetchedPort = parseInt(portText.trim(), 10);
            if (!isNaN(fetchedPort) && fetchedPort > 0) {
              BRIDGE_PORT = fetchedPort;
              BRIDGE_URL = `ws://localhost:${BRIDGE_PORT}`;
              localStorage.setItem(BRIDGE_PORT_STORAGE_KEY, String(BRIDGE_PORT));
              return true;
            }
          }
        } catch (e) {
          continue;
        }
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  function setupBridgeSocket() {
    if (
      bridgeSocket &&
      (bridgeSocket.readyState === WebSocket.OPEN ||
        bridgeSocket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    try {
      bridgeSocket = new WebSocket(BRIDGE_URL);
    } catch (error) {
      scheduleBridgeRetry();
      return;
    }

    bridgeSocket.addEventListener("open", () => {
      bridgeReady = true;
      flushBridgeQueue();
    });

    bridgeSocket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "local-asset-response") {
          // Handle asset responses if needed
        }
      } catch (e) {
        // Ignore parse errors
      }
    });

    bridgeSocket.addEventListener("error", () => {
      bridgeReady = false;
    });

    bridgeSocket.addEventListener("close", () => {
      bridgeReady = false;
      bridgeSocket = null;
      scheduleBridgeRetry();
    });
  }

  function scheduleBridgeRetry() {
    setTimeout(() => {
      if (!bridgeReady) {
        setupBridgeSocket();
      }
    }, 3000);
  }

  function flushBridgeQueue() {
    if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    while (bridgeQueue.length) {
      const message = bridgeQueue.shift();
      try {
        bridgeSocket.send(message);
      } catch (error) {
        bridgeQueue.unshift(message);
        break;
      }
    }
  }

  function sendToBridge(payload) {
    const message = JSON.stringify(payload);
    if (
      !bridgeSocket ||
      bridgeSocket.readyState === WebSocket.CLOSING ||
      bridgeSocket.readyState === WebSocket.CLOSED
    ) {
      bridgeQueue.push(message);
      setupBridgeSocket();
      return;
    }

    if (bridgeSocket.readyState === WebSocket.CONNECTING) {
      bridgeQueue.push(message);
      return;
    }

    try {
      bridgeSocket.send(message);
    } catch (error) {
      bridgeQueue.push(message);
      setupBridgeSocket();
    }
  }

  function emit(payload) {
    const emitter = window?.__roseBridgeEmit;
    if (typeof emitter !== "function") {
      if (emitRetryCount < 60) {
        emitRetryCount += 1;
        setTimeout(() => emit(payload), 200);
      }
      return;
    }
    emitRetryCount = 0;
    emitter(payload);
  }

  function formatTimestamp(ms) {
    if (!ms) return "";
    try {
      return new Date(ms).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  const CSS_RULES = `
    .${BUTTON_CLASS} {
      pointer-events: auto;
      -webkit-user-select: none;
      list-style-type: none;
      cursor: pointer;
      display: block !important;
      height: 25px;
      width: 25px;
      z-index: 1;
    }

    .${BUTTON_CLASS}[data-hidden],
    .${BUTTON_CLASS}[data-hidden] * {
      pointer-events: none !important;
      cursor: default !important;
      visibility: hidden !important;
    }

    .${BUTTON_CLASS} .outer-mask {
      pointer-events: auto;
      -webkit-user-select: none;
      list-style-type: none;
      cursor: pointer;
      border-radius: 50%;
      box-shadow: 0 0 4px 1px rgba(1,10,19,.25);
      box-sizing: border-box;
      height: 100%;
      overflow: hidden;
      position: relative;
    }

    .${BUTTON_CLASS} .frame-color {
      --champion-preview-hover-animation-percentage: 0%;
      --column-height: 95px;
      --font-display: "LoL Display","Times New Roman",Times,Baskerville,Georgia,serif;
      --font-body: "LoL Body",Arial,"Helvetica Neue",Helvetica,sans-serif;
      pointer-events: auto;
      -webkit-user-select: none;
      list-style-type: none;
      cursor: default;
      background-image: linear-gradient(0deg,#695625 0,#a9852d 23%,#b88d35 93%,#c8aa6e);
      box-sizing: border-box;
      height: 100%;
      overflow: hidden;
      width: 100%;
      padding: 2px;
    }

    .${BUTTON_CLASS} .content {
      pointer-events: auto;
      -webkit-user-select: none;
      list-style-type: none;
      cursor: pointer;
      display: block;
      background: url(/fe/lol-champ-select/images/config/button-chroma.png) no-repeat;
      background-size: contain;
      border: 2px solid #010a13;
      border-radius: 50%;
      height: 16px;
      margin: 1px;
      width: 16px;
    }

    .${BUTTON_CLASS} .inner-mask {
      -webkit-user-select: none;
      list-style-type: none;
      cursor: default;
      border-radius: 50%;
      box-sizing: border-box;
      overflow: hidden;
      pointer-events: none;
      position: absolute;
      box-shadow: inset 0 0 4px 4px rgba(0,0,0,.75);
      width: calc(100% - 4px);
      height: calc(100% - 4px);
      left: 2px;
      top: 2px;
    }


    .chroma.icon {
      display: none !important;
    }

    .${PANEL_CLASS} {
      position: fixed;
      z-index: 10000;
      pointer-events: all;
      -webkit-user-select: none;
    }

    .${PANEL_CLASS}[data-no-button] {
      pointer-events: none;
      cursor: default !important;
    }

    .${PANEL_CLASS}[data-no-button] * {
      pointer-events: none !important;
      cursor: default !important;
    }

    .${PANEL_CLASS} .chroma-modal {
      background: #000;
      display: flex;
      flex-direction: column;
      width: 305px;
      position: relative;
      z-index: 0;
      padding: 16px;
      box-sizing: border-box;
    }
    
    .${PANEL_CLASS} .chroma-modal.chroma-view {
      max-height: 400px;
      min-height: 200px;
    }
    
    .${PANEL_CLASS} .flyout {
      position: absolute;
      overflow: visible;
      pointer-events: all;
      -webkit-user-select: none;
    }

    .${PANEL_CLASS}[data-no-button] .flyout {
      pointer-events: none !important;
      cursor: default !important;
    }
    
    .${PANEL_CLASS} .flyout-frame {
      position: relative;
      transition: 250ms all cubic-bezier(0.02, 0.85, 0.08, 0.99);
    }
    
    .${PANEL_CLASS} .flyout .caret,
    .${PANEL_CLASS} .flyout [class*="caret"],
    .${PANEL_CLASS} lol-uikit-flyout-frame .caret,
    .${PANEL_CLASS} lol-uikit-flyout-frame [class*="caret"],
    .${PANEL_CLASS} .flyout::part(caret),
    .${PANEL_CLASS} lol-uikit-flyout-frame::part(caret) {
      z-index: 3 !important;
      position: relative;
    }
    
    .${PANEL_CLASS} .lc-flyout-content {
      position: relative;
    }

    .${PANEL_CLASS} .mod-selection {
      pointer-events: all;
      flex: 1;
      overflow: auto;
      transform: translateZ(0);
      -webkit-mask-box-image-source: url("/fe/lol-static-assets/images/uikit/scrollable/scrollable-content-gradient-mask-bottom.png");
      -webkit-mask-box-image-slice: 0 8 18 0 fill;
      display: flex;
      flex-direction: column;
      width: 100%;
      position: relative;
      z-index: 1;
      min-height: 150px;
    }

    .${PANEL_CLASS}[data-no-button] .mod-selection {
      pointer-events: none;
      cursor: default;
    }

    .${PANEL_CLASS} .mod-selection ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      width: 100%;
      gap: 6px;
    }

    .${PANEL_CLASS} .mod-selection li {
      list-style: none;
      margin: 0;
      padding: 8px 12px;
      display: flex;
      flex-direction: column;
      gap: 3px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      transition: background 0.15s ease, border-color 0.15s ease;
    }

    .${PANEL_CLASS} .mod-selection li:hover {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(200, 155, 60, 0.3);
    }

    .${PANEL_CLASS} .mod-name {
      color: #f7f0de;
      font-family: "LoL Body", Arial, "Helvetica Neue", Helvetica, sans-serif;
      font-size: 13px;
      font-weight: 600;
    }

    .${PANEL_CLASS} .mod-description {
      color: rgba(247, 240, 222, 0.7);
      font-family: "LoL Body", Arial, "Helvetica Neue", Helvetica, sans-serif;
      font-size: 11px;
      font-weight: 400;
    }

    .${PANEL_CLASS} .mod-meta {
      color: rgba(247, 240, 222, 0.5);
      font-family: "LoL Body", Arial, "Helvetica Neue", Helvetica, sans-serif;
      font-size: 10px;
      font-weight: 400;
      font-style: italic;
    }

    .${PANEL_CLASS} .mod-loading {
      color: rgba(247, 240, 222, 0.6);
      font-family: "LoL Body", Arial, "Helvetica Neue", Helvetica, sans-serif;
      font-size: 12px;
      text-align: center;
      padding: 10px;
    }

    .${PANEL_CLASS} .mod-open-folder {
      background: transparent;
      border: 1px solid rgba(200, 155, 60, 0.5);
      border-radius: 4px;
      padding: 6px 12px;
      color: #c89b3c;
      font-family: "LoL Body", Arial, "Helvetica Neue", Helvetica, sans-serif;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s ease;
      margin: 0 0 12px 0;
      align-self: flex-start;
      width: 100%;
      box-sizing: border-box;
    }

    .${PANEL_CLASS} .mod-open-folder:hover {
      background: rgba(200, 155, 60, 0.1);
      border-color: #c89b3c;
    }
  `;

  function injectCSS() {
    const styleId = "rose-custom-wheel-css";
    if (document.getElementById(styleId)) {
      return;
    }

    const styleTag = document.createElement("style");
    styleTag.id = styleId;
    styleTag.textContent = CSS_RULES;
    document.head.appendChild(styleTag);
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
      event.preventDefault();
      isOpen ? closePanel() : openPanel();
    });

    return button;
  }

  function createPanel() {
    if (panel) {
      return panel;
    }

    // Remove existing panel if any
    const existingPanel = document.getElementById(PANEL_ID);
    if (existingPanel) {
      existingPanel.remove();
    }

    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = PANEL_CLASS;
    panel.style.position = "fixed";
    panel.style.top = "0";
    panel.style.left = "0";
    panel.style.width = "100%";
    panel.style.height = "100%";
    panel.style.zIndex = "10000";
    panel.style.pointerEvents = "none";
    panel.style.display = "none"; // Hidden by default

    // Create flyout frame structure
    let flyoutFrame;
    try {
      flyoutFrame = document.createElement("lol-uikit-flyout-frame");
      flyoutFrame.className = "flyout";
      flyoutFrame.setAttribute("orientation", "top");
      flyoutFrame.setAttribute("animated", "false");
      flyoutFrame.setAttribute("show", "true");
    } catch (e) {
      flyoutFrame = document.createElement("div");
      flyoutFrame.className = "flyout";
    }

    flyoutFrame.style.position = "absolute";
    flyoutFrame.style.overflow = "visible";
    flyoutFrame.style.pointerEvents = "all";

    let flyoutContent;
    try {
      flyoutContent = document.createElement("lc-flyout-content");
    } catch (e) {
      flyoutContent = document.createElement("div");
      flyoutContent.className = "lc-flyout-content";
    }

    const modal = document.createElement("div");
    modal.className = "champ-select-chroma-modal chroma-view ember-view";

    // Scrollable area for mod list
    let scrollable;
    try {
      scrollable = document.createElement("lol-uikit-scrollable");
      scrollable.className = "mod-selection";
      scrollable.setAttribute("overflow-masks", "enabled");
    } catch (e) {
      scrollable = document.createElement("div");
      scrollable.className = "mod-selection";
      scrollable.style.overflowY = "auto";
    }

    // Create ul list for mod entries
    const modList = document.createElement("ul");
    modList.style.listStyle = "none";
    modList.style.margin = "0";
    modList.style.padding = "0";
    modList.style.display = "flex";
    modList.style.flexDirection = "column";
    modList.style.width = "100%";
    modList.style.gap = "4px";

    // Loading element
    const loadingEl = document.createElement("div");
    loadingEl.className = "mod-loading";
    loadingEl.textContent = "Waiting for mods…";
    loadingEl.style.display = "none";

    // Open folder button
    const openFolderBtn = document.createElement("button");
    openFolderBtn.className = "mod-open-folder";
    openFolderBtn.textContent = "Open Mods Folder";
    openFolderBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      emit({ type: OPEN_FOLDER_TYPE });
    });

    scrollable.appendChild(loadingEl);
    scrollable.appendChild(openFolderBtn);
    scrollable.appendChild(modList);

    modal.appendChild(scrollable);
    flyoutContent.appendChild(modal);
    flyoutFrame.appendChild(flyoutContent);
    panel.appendChild(flyoutFrame);

    // Store references
    panel._modList = modList;
    panel._loadingEl = loadingEl;

    return panel;
  }

  function positionPanel(panelElement, buttonElement) {
    if (!panelElement || !buttonElement) {
      return;
    }

    const flyoutFrame = panelElement.querySelector(".flyout");
    if (!flyoutFrame) {
      return;
    }

    const rect = buttonElement.getBoundingClientRect();
    let flyoutRect = flyoutFrame.getBoundingClientRect();

    if (flyoutRect.width === 0) {
      flyoutRect = { width: 305, height: 300 };
    }

    const buttonCenterX = rect.left + rect.width / 2;
    const flyoutLeft = buttonCenterX - flyoutRect.width / 2;
    const flyoutTop = rect.top - flyoutRect.height - 15;

    flyoutFrame.style.position = "absolute";
    flyoutFrame.style.overflow = "visible";
    flyoutFrame.style.top = `${Math.max(10, flyoutTop)}px`;
    flyoutFrame.style.left = `${Math.max(
      10,
      Math.min(flyoutLeft, window.innerWidth - flyoutRect.width - 10)
    )}px`;

    panelElement.style.position = "fixed";
    panelElement.style.top = "0";
    panelElement.style.left = "0";
    panelElement.style.width = "100%";
    panelElement.style.height = "100%";
    panelElement.style.pointerEvents = "none";
    flyoutFrame.style.pointerEvents = "all";
  }

  function updateModEntries(mods) {
    if (!panel || !panel._modList || !panel._loadingEl) {
      return;
    }

    const modList = panel._modList;
    const loadingEl = panel._loadingEl;

    modList.innerHTML = "";

    if (!mods || mods.length === 0) {
      loadingEl.textContent = "No mods found";
      loadingEl.style.display = "block";
      return;
    }

    loadingEl.style.display = "none";

    mods.forEach((mod) => {
      const listItem = document.createElement("li");

      const modName = document.createElement("div");
      modName.className = "mod-name";
      modName.textContent = mod.modName || "Unnamed mod";
      listItem.appendChild(modName);

      if (mod.description) {
        const modDesc = document.createElement("div");
        modDesc.className = "mod-description";
        modDesc.textContent = mod.description;
        listItem.appendChild(modDesc);
      }

      const modMeta = document.createElement("div");
      modMeta.className = "mod-meta";
      const parts = [];
      if (mod.relativePath) {
        parts.push(mod.relativePath);
      }
      if (mod.updatedAt) {
        parts.push(formatTimestamp(mod.updatedAt));
      }
      modMeta.textContent = parts.join(" • ");
      listItem.appendChild(modMeta);

      modList.appendChild(listItem);
    });
  }


  function findButtonContainer() {
    // Find the same container that RandomSkin uses
    const carouselContainer = document.querySelector(".skin-selection-carousel-container");
    if (carouselContainer) {
      return carouselContainer;
    }
    
    const carousel = document.querySelector(".skin-selection-carousel");
    if (carousel) {
      return carousel;
    }
    
    const mainContainer = document.querySelector(".champion-select-main-container");
    if (mainContainer) {
      const visibleDiv = mainContainer.querySelector("div.visible");
      if (visibleDiv) {
        return visibleDiv;
      }
    }
    
    return null;
  }

  function findRandomSkinButton() {
    // Find the random skin button element
    const randomButton = document.querySelector(".lu-random-dice-button");
    if (randomButton) {
      return randomButton;
    }
    return null;
  }

  function findButtonLocation() {
    // First, try to find the random skin button and position next to it
    const randomButton = findRandomSkinButton();
    if (randomButton) {
      const rect = randomButton.getBoundingClientRect();
      // Position to the right of the random button with some spacing
      return {
        x: rect.right + 8, // 8px spacing to the right
        y: rect.top,
        width: 25,
        height: 25,
        relativeTo: randomButton
      };
    }

    // Fallback: position similar to random button (centered below skin, but to the right)
    const allItems = document.querySelectorAll(".skin-selection-item");
    for (const item of allItems) {
      if (item.classList.contains("skin-carousel-offset-2")) {
        const rect = item.getBoundingClientRect();
        // Position to the right of where random button would be (centered + 38px + 8px spacing)
        return {
          x: rect.left + rect.width / 2 + 19 + 8, // Half width + random button width + spacing
          y: rect.top + 78, // Same y as random button
          width: 25,
          height: 25,
          relativeTo: item
        };
      }
    }

    const selectedItem = document.querySelector(".skin-selection-item.skin-selection-item-selected");
    if (selectedItem) {
      const rect = selectedItem.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2 + 19 + 8,
        y: rect.top + 78,
        width: 25,
        height: 25,
        relativeTo: selectedItem
      };
    }

    return null;
  }

  function attachToChampionSelect() {
    if (!championSelectRoot || !championLocked) {
      return;
    }

    createButton();
    createPanel();

    const targetContainer = findButtonContainer();
    if (!targetContainer) {
      return;
    }

    const location = findButtonLocation();
    if (!location) {
      return;
    }

    // Remove button from old parent if it exists
    if (button.parentNode) {
      button.parentNode.removeChild(button);
    }

    // Get container's position relative to viewport for absolute positioning
    const containerRect = targetContainer.getBoundingClientRect();

    // Ensure container has positioning context for absolute children
    const containerComputedStyle = window.getComputedStyle(targetContainer);
    if (containerComputedStyle.position === 'static') {
      targetContainer.style.position = 'relative';
    }

    // Position button absolutely within container
    button.style.position = "absolute";
    button.style.left = `${location.x - containerRect.left}px`;
    button.style.top = `${location.y - containerRect.top}px`;
    button.style.width = `${location.width}px`;
    button.style.height = `${location.height}px`;
    button.style.zIndex = "1"; // Above random button (which is z-index 0)
    button.style.display = "block";
    button.style.visibility = "visible";
    button.style.opacity = "1";

    // Remove the default positioning classes that might interfere
    button.style.bottom = "";
    button.style.transform = "";

    targetContainer.appendChild(button);

    // Store references for repositioning
    button._relativeTo = location.relativeTo;
    button._container = targetContainer;

    if (panel.parentNode !== document.body) {
      document.body.appendChild(panel);
    }
  }

  function detachFromChampionSelect() {
    if (button && button.parentNode) {
      button.parentNode.removeChild(button);
    }
    closePanel(); // Ensure panel is closed when detaching
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

  function openPanel() {
    if (!championLocked) {
      return;
    }
    if (!championSelectRoot) {
      return;
    }

    attachToChampionSelect();

    if (!panel || !button) {
      return;
    }

    // Create panel if it doesn't exist
    if (!panel.parentNode) {
      document.body.appendChild(panel);
    }

    // Show panel
    panel.style.display = "block";
    panel.style.pointerEvents = "none"; // Will be set to "all" by flyout frame

    positionPanel(panel, button);

    // Force a reflow
    panel.offsetHeight;

    // Reposition after render
    setTimeout(() => {
      positionPanel(panel, button);
    }, 0);

    isOpen = true;
    requestModsForCurrentSkin();

    // Add click outside handler
    const closeHandler = (e) => {
      if (
        panel &&
        panel.parentNode &&
        !panel.contains(e.target) &&
        !button.contains(e.target)
      ) {
        closePanel();
        document.removeEventListener("click", closeHandler);
      }
    };
    setTimeout(() => {
      document.addEventListener("click", closeHandler);
    }, 100);
  }

  function closePanel() {
    if (!panel) {
      isOpen = false;
      return;
    }
    // Hide panel but keep it in DOM for reuse
    if (panel.parentNode) {
      panel.style.display = "none";
      panel.style.pointerEvents = "none";
    }
    isOpen = false;
  }

  function requestModsForCurrentSkin() {
    const state = window.__roseSkinState || {};
    const championId = Number(state.championId);
    const skinId = Number(state.skinId);

    if (!championId || !skinId) {
      if (panel && panel._loadingEl) {
        panel._loadingEl.textContent = "Hover a skin...";
        panel._loadingEl.style.display = "block";
      }
      return;
    }

    emit({ type: REQUEST_TYPE, championId, skinId });

    if (panel && panel._loadingEl) {
      panel._loadingEl.textContent = "Checking for mods…";
      panel._loadingEl.style.display = "block";
    }
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
      return;
    }

    const mods = Array.isArray(detail.mods) ? detail.mods : [];
    updateModEntries(mods);
  }

  function handleChampionLocked(event) {
    const locked = Boolean(event?.detail?.locked);
    if (locked === championLocked) {
      return;
    }
    championLocked = locked;
    refreshUIVisibility();
  }

  function whenReady(cb) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", cb, { once: true });
      return;
    }
    cb();
  }

  whenReady(() => {
    loadBridgePort().then(() => {
      setupBridgeSocket();
    });

    injectCSS();
    createButton();
    createPanel();
    updateChampionSelectTarget();
    observeChampionSelect();

    window.addEventListener(EVENT_SKIN_STATE, handleSkinState, {
      passive: true,
    });
    window.addEventListener(EVENT_MODS_RESPONSE, handleModsResponse, {
      passive: true,
    });
    window.addEventListener(EVENT_LOCK_STATE, handleChampionLocked, {
      passive: true,
    });
    // Reposition button when random button moves or skin changes
    const repositionButton = () => {
      if (button && button.parentNode && championLocked) {
        const location = findButtonLocation();
        if (location && button._container) {
          const containerRect = button._container.getBoundingClientRect();
          button.style.left = `${location.x - containerRect.left}px`;
          button.style.top = `${location.y - containerRect.top}px`;
        }
      }
      if (isOpen && panel && button) {
        positionPanel(panel, button);
      }
    };

    window.addEventListener("resize", repositionButton);
    window.addEventListener("scroll", repositionButton);

    // Observe for random button changes
    const observeRandomButton = () => {
      const randomButton = findRandomSkinButton();
      if (randomButton && button && button.parentNode) {
        repositionButton();
      }
    };

    // Check periodically for random button
    setInterval(observeRandomButton, 500);
  });
})();
