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
  let selectedModId = null; // Track which mod is currently selected
  let selectedModSkinId = null; // Track which skin the selected mod belongs to
  let activeTab = "skins"; // Current active tab: "skins", "maps", "fonts", "announcers"
  let selectedMapId = null;
  let selectedFontId = null;
  let selectedAnnouncerId = null;

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
        if (payload.type === "local-asset-url") {
          // Handle asset URL response - update button images
          const { assetPath, url } = payload;
          if (button) {
            const defaultImg = button.querySelector(".button-image.default");
            const pressedImg = button.querySelector(".button-image.pressed");
            
            if (assetPath === "tftm_promotebutton_default.png" && defaultImg && url) {
              defaultImg.style.backgroundImage = `url('${url}')`;
              defaultImg.style.backgroundSize = "contain";
              defaultImg.style.backgroundPosition = "center";
              defaultImg.style.backgroundRepeat = "no-repeat";
            } else if (assetPath === "tftm_promotebutton_pressed.png" && pressedImg && url) {
              pressedImg.style.backgroundImage = `url('${url}')`;
              pressedImg.style.backgroundSize = "contain";
              pressedImg.style.backgroundPosition = "center";
              pressedImg.style.backgroundRepeat = "no-repeat";
            }
          }
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
      cursor: pointer;
      box-sizing: border-box;
      height: 20px;
      width: 20px;
      position: absolute !important;
      display: block !important;
      z-index: 1;
      margin: 0;
      padding: 0;
    }

    .${BUTTON_CLASS}[data-hidden],
    .${BUTTON_CLASS}[data-hidden] * {
      pointer-events: none !important;
      cursor: default !important;
      visibility: hidden !important;
    }

    .${BUTTON_CLASS} .button-image {
      pointer-events: auto;
      -webkit-user-select: none;
      cursor: pointer;
      display: block;
      width: 100%;
      height: 100%;
      background-size: contain;
      background-position: center;
      background-repeat: no-repeat;
      transition: opacity 0.1s ease;
      position: absolute;
      top: 0;
      left: 0;
      min-width: 20px;
      min-height: 20px;
      background-color: transparent !important;
      border: none !important;
    }
    
    .${BUTTON_CLASS} .button-image.default {
      background-color: transparent;
      border: none;
      border-radius: 2px;
    }

    .${BUTTON_CLASS} .button-image.default {
      opacity: 1;
    }

    .${BUTTON_CLASS} .button-image.pressed {
      opacity: 0;
      background-color: transparent !important;
      border: none !important;
    }

    .${BUTTON_CLASS}.pressed .button-image.default {
      opacity: 0;
    }

    .${BUTTON_CLASS}.pressed .button-image.pressed {
      opacity: 1;
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
      width: auto;
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
      width: auto !important;
    }

    .${PANEL_CLASS}[data-no-button] .flyout {
      pointer-events: none !important;
      cursor: default !important;
    }
    
    .${PANEL_CLASS} .flyout-frame {
      position: relative;
      transition: 250ms all cubic-bezier(0.02, 0.85, 0.08, 0.99);
      width: auto !important;
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
      width: auto;
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
      width: auto;
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

    .${PANEL_CLASS} .mod-name-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    
    .${PANEL_CLASS} .mod-name {
      color: #f7f0de;
      font-family: "LoL Body", Arial, "Helvetica Neue", Helvetica, sans-serif;
      font-size: 13px;
      font-weight: 600;
      flex: 1;
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

    .${PANEL_CLASS} .mod-select-button {
      background: rgba(200, 155, 60, 0.2);
      border: 1px solid rgba(200, 155, 60, 0.5);
      border-radius: 4px;
      padding: 4px 12px;
      color: #c89b3c;
      font-family: "LoL Body", Arial, "Helvetica Neue", Helvetica, sans-serif;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s ease;
      flex-shrink: 0;
    }

    .${PANEL_CLASS} .mod-select-button:hover {
      background: rgba(200, 155, 60, 0.3);
      border-color: #c89b3c;
    }

    .${PANEL_CLASS} .mod-select-button.selected {
      background: rgba(200, 155, 60, 0.4);
      border-color: #c89b3c;
      color: #f0e6d2;
    }

    .${PANEL_CLASS} .mod-injection-note {
      color: rgba(247, 240, 222, 0.5);
      font-family: "LoL Body", Arial, "Helvetica Neue", Helvetica, sans-serif;
      font-size: 10px;
      font-style: italic;
      margin-top: 8px;
      padding: 8px;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }

    .${PANEL_CLASS} .tab-container {
      display: flex;
      gap: 4px;
      margin-bottom: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 8px;
      width: fit-content;
      flex-wrap: nowrap;
    }

    .${PANEL_CLASS} .tab-button {
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .${PANEL_CLASS} .tab-content {
      display: none;
      width: auto;
    }

    .${PANEL_CLASS} .tab-content.active {
      display: flex;
      flex-direction: column;
      width: auto;
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
    
    // Create image elements for default and pressed states
    const defaultImg = document.createElement("div");
    defaultImg.className = "button-image default";
    // Don't set background image yet - wait for HTTP URL from Python
    
    const pressedImg = document.createElement("div");
    pressedImg.className = "button-image pressed";
    // Don't set background image yet - wait for HTTP URL from Python
    
    button.appendChild(defaultImg);
    button.appendChild(pressedImg);

    // Request button images from Python backend
    if (bridgeReady) {
      emit({
        type: "request-local-asset",
        assetPath: "tftm_promotebutton_default.png",
      });
      emit({
        type: "request-local-asset",
        assetPath: "tftm_promotebutton_pressed.png",
      });
    } else {
      bridgeQueue.push(JSON.stringify({
        type: "request-local-asset",
        assetPath: "tftm_promotebutton_default.png",
      }));
      bridgeQueue.push(JSON.stringify({
        type: "request-local-asset",
        assetPath: "tftm_promotebutton_pressed.png",
      }));
    }

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

    // Tab container
    const tabContainer = document.createElement("div");
    tabContainer.className = "tab-container";

    // Create tabs using League UI components
    const modsTab = document.createElement("lol-uikit-flat-button-secondary");
    modsTab.className = "tab-button active";
    modsTab.textContent = "Skins";
    modsTab.dataset.tab = "skins";
    
    const mapsTab = document.createElement("lol-uikit-flat-button-secondary");
    mapsTab.className = "tab-button";
    mapsTab.textContent = "Maps";
    mapsTab.dataset.tab = "maps";
    
    const fontsTab = document.createElement("lol-uikit-flat-button-secondary");
    fontsTab.className = "tab-button";
    fontsTab.textContent = "Fonts";
    fontsTab.dataset.tab = "fonts";
    
    const announcersTab = document.createElement("lol-uikit-flat-button-secondary");
    announcersTab.className = "tab-button";
    announcersTab.textContent = "Announcers";
    announcersTab.dataset.tab = "announcers";

    // Tab click handlers
    const switchTab = (tabName) => {
      activeTab = tabName;
      // Update tab buttons
      [modsTab, mapsTab, fontsTab, announcersTab].forEach(tab => {
        if (tab.dataset.tab === tabName) {
          tab.classList.add("active");
        } else {
          tab.classList.remove("active");
        }
      });
      // Update tab content
      [panel._modsContent, panel._mapsContent, panel._fontsContent, panel._announcersContent].forEach(content => {
        if (content.dataset.tab === tabName) {
          content.classList.add("active");
        } else {
          content.classList.remove("active");
        }
      });
      // Request data for the active tab (always request fresh data)
      if (tabName === "skins") {
        requestModsForCurrentSkin();
      } else if (tabName === "maps") {
        requestMaps();
      } else if (tabName === "fonts") {
        requestFonts();
      } else if (tabName === "announcers") {
        requestAnnouncers();
      }
    };

    modsTab.addEventListener("click", () => switchTab("skins"));
    mapsTab.addEventListener("click", () => switchTab("maps"));
    fontsTab.addEventListener("click", () => switchTab("fonts"));
    announcersTab.addEventListener("click", () => switchTab("announcers"));

    tabContainer.appendChild(modsTab);
    tabContainer.appendChild(mapsTab);
    tabContainer.appendChild(fontsTab);
    tabContainer.appendChild(announcersTab);

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

    // Create tab content containers
    const modsContent = document.createElement("div");
    modsContent.className = "tab-content active";
    modsContent.dataset.tab = "skins";

    const mapsContent = document.createElement("div");
    mapsContent.className = "tab-content";
    mapsContent.dataset.tab = "maps";

    const fontsContent = document.createElement("div");
    fontsContent.className = "tab-content";
    fontsContent.dataset.tab = "fonts";

    const announcersContent = document.createElement("div");
    announcersContent.className = "tab-content";
    announcersContent.dataset.tab = "announcers";

    // Create ul lists for each tab
    const modList = document.createElement("ul");
    modList.style.listStyle = "none";
    modList.style.margin = "0";
    modList.style.padding = "0";
    modList.style.display = "flex";
    modList.style.flexDirection = "column";
    modList.style.width = "100%";
    modList.style.gap = "4px";

    const mapsList = document.createElement("ul");
    mapsList.style.listStyle = "none";
    mapsList.style.margin = "0";
    mapsList.style.padding = "0";
    mapsList.style.display = "flex";
    mapsList.style.flexDirection = "column";
    mapsList.style.width = "100%";
    mapsList.style.gap = "4px";

    const fontsList = document.createElement("ul");
    fontsList.style.listStyle = "none";
    fontsList.style.margin = "0";
    fontsList.style.padding = "0";
    fontsList.style.display = "flex";
    fontsList.style.flexDirection = "column";
    fontsList.style.width = "100%";
    fontsList.style.gap = "4px";

    const announcersList = document.createElement("ul");
    announcersList.style.listStyle = "none";
    announcersList.style.margin = "0";
    announcersList.style.padding = "0";
    announcersList.style.display = "flex";
    announcersList.style.flexDirection = "column";
    announcersList.style.width = "100%";
    announcersList.style.gap = "4px";

    // Loading elements for each tab
    const modsLoading = document.createElement("div");
    modsLoading.className = "mod-loading";
    modsLoading.textContent = "Waiting for mods…";
    modsLoading.style.display = "none";

    const mapsLoading = document.createElement("div");
    mapsLoading.className = "mod-loading";
    mapsLoading.textContent = "Loading maps…";
    mapsLoading.style.display = "none";

    const fontsLoading = document.createElement("div");
    fontsLoading.className = "mod-loading";
    fontsLoading.textContent = "Loading fonts…";
    fontsLoading.style.display = "none";

    const announcersLoading = document.createElement("div");
    announcersLoading.className = "mod-loading";
    announcersLoading.textContent = "Loading announcers…";
    announcersLoading.style.display = "none";

    // Assemble mods content
    modsContent.appendChild(modsLoading);
    modsContent.appendChild(modList);

    // Assemble other tabs content
    mapsContent.appendChild(mapsLoading);
    mapsContent.appendChild(mapsList);

    fontsContent.appendChild(fontsLoading);
    fontsContent.appendChild(fontsList);

    announcersContent.appendChild(announcersLoading);
    announcersContent.appendChild(announcersList);

    scrollable.appendChild(tabContainer);
    scrollable.appendChild(modsContent);
    scrollable.appendChild(mapsContent);
    scrollable.appendChild(fontsContent);
    scrollable.appendChild(announcersContent);

    modal.appendChild(scrollable);
    flyoutContent.appendChild(modal);
    flyoutFrame.appendChild(flyoutContent);
    panel.appendChild(flyoutFrame);

    // Store references
    panel._modList = modList;
    panel._mapsList = mapsList;
    panel._fontsList = fontsList;
    panel._announcersList = announcersList;
    panel._modsLoading = modsLoading;
    panel._mapsLoading = mapsLoading;
    panel._fontsLoading = fontsLoading;
    panel._announcersLoading = announcersLoading;
    panel._modsContent = modsContent;
    panel._mapsContent = mapsContent;
    panel._fontsContent = fontsContent;
    panel._announcersContent = announcersContent;
    panel._loadingEl = modsLoading; // Keep for backward compatibility

    // Function to calculate and set panel width to exactly match tab container width
    const calculateWidth = () => {
      const tabContainerEl = modal.querySelector(".tab-container");
      if (!tabContainerEl) return;
      
      // Remove all constraints to measure natural size
      const originalModalWidth = modal.style.width;
      const originalContainerWidth = tabContainerEl.style.width;
      
      tabContainerEl.style.width = "fit-content";
      modal.style.width = "auto";
      modal.style.maxWidth = "none";
      modal.style.minWidth = "0";
      
      // Force reflow multiple times
      void tabContainerEl.offsetWidth;
      void modal.offsetWidth;
      void tabContainerEl.offsetWidth;
      
      // Measure each tab button directly - this should be the most accurate
      const tabs = tabContainerEl.querySelectorAll(".tab-button");
      let totalTabWidth = 0;
      
      tabs.forEach((tab, index) => {
        // Force each tab to render before measuring
        void tab.offsetWidth;
        const rect = tab.getBoundingClientRect();
        totalTabWidth += rect.width;
        if (index < tabs.length - 1) {
          totalTabWidth += 4; // gap between tabs (from CSS gap: 4px)
        }
      });
      
      if (totalTabWidth > 0) {
        // With box-sizing: border-box, width includes padding
        // Try using just the tab width - maybe padding is already accounted for somehow
        // Or the measurement is already including what we need
        modal.style.width = `${totalTabWidth}px`;
        modal.style.maxWidth = "";
        modal.style.minWidth = "";
        tabContainerEl.style.width = "fit-content";
        
        // Reposition panel after width is set to ensure it's centered above the button
        if (button && isOpen) {
          // Use requestAnimationFrame to ensure width is applied before repositioning
          requestAnimationFrame(() => {
            positionPanel(panel, button);
          });
        }
      } else {
        modal.style.width = originalModalWidth;
        tabContainerEl.style.width = originalContainerWidth;
      }
    };
    
    // Store on panel for later use
    panel._calculateWidth = calculateWidth;
    
    // Try multiple times to ensure tabs are fully rendered
    setTimeout(calculateWidth, 50);
    setTimeout(calculateWidth, 150);
    setTimeout(calculateWidth, 300);

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
      // Try to get width from the modal element
      const modal = flyoutFrame.querySelector(".chroma-modal");
      if (modal) {
        const modalRect = modal.getBoundingClientRect();
        if (modalRect.width > 0) {
          flyoutRect = { width: modalRect.width, height: flyoutRect.height || 300 };
        } else {
          // Fallback: use button width + estimated padding
          flyoutRect = { width: rect.width + 32, height: 300 };
        }
      } else {
        // Fallback: use button width + estimated padding
        flyoutRect = { width: rect.width + 32, height: 300 };
      }
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

  function handleModSelect(modId, buttonElement, modData) {
    // Toggle selection
    if (selectedModId === modId) {
      // Deselect
      selectedModId = null;
      selectedModSkinId = null;
      buttonElement.textContent = "Select";
      buttonElement.classList.remove("selected");

      // Emit deselection to Python backend (modId: null means deselect)
      const state = window.__roseSkinState || {};
      const championId = Number(state.championId);
      const skinId = Number(state.skinId);
      
      if (championId && skinId) {
        emit({
          type: "select-skin-mod",
          championId,
          skinId,
          modId: null, // null means deselect
          modData: null,
        });
      }
    } else {
      // Deselect previous button if any
      if (selectedModId) {
        const previousButton = panel?._modList?.querySelector(
          `[data-mod-id="${selectedModId}"] .mod-select-button`
        );
        if (previousButton) {
          previousButton.textContent = "Select";
          previousButton.classList.remove("selected");
        }
      }

      // Select new mod
      selectedModId = modId;
      const state = window.__roseSkinState || {};
      const skinId = Number(state.skinId);
      selectedModSkinId = skinId; // Store the skin ID for this selection
      
      buttonElement.textContent = "Selected";
      buttonElement.classList.add("selected");

      // Emit selection to Python backend
      const championId = Number(state.championId);
      
      if (championId && skinId) {
        const payload = {
          type: "select-skin-mod",
          championId,
          skinId,
          modId,
          modData,
        };
        console.log(`[ROSE-CustomWheel] Sending mod selection:`, payload);
        emit(payload);
      } else {
        console.warn(`[ROSE-CustomWheel] Cannot send mod selection - missing championId or skinId:`, { championId, skinId });
      }
    }
  }

  function updateModEntries(mods) {
    if (!panel || !panel._modList || !panel._loadingEl) {
      return;
    }

    const modList = panel._modList;
    const loadingEl = panel._loadingEl;

    // Store current selectedModId before clearing the list
    const previousSelectedModId = selectedModId;
    
    modList.innerHTML = "";
    
    // Don't reset selection - restore it if it still exists in the mod list

    if (!mods || mods.length === 0) {
      loadingEl.textContent = "No mods found";
      loadingEl.style.display = "block";
      return;
    }

    loadingEl.style.display = "none";

    mods.forEach((mod) => {
      const listItem = document.createElement("li");
      // Use relativePath as the unique identifier, fallback to modName
      const modId = mod.relativePath || mod.modName || `mod-${Date.now()}-${Math.random()}`;

      // Create a row container for name and button
      const modNameRow = document.createElement("div");
      modNameRow.className = "mod-name-row";

      const modName = document.createElement("div");
      modName.className = "mod-name";
      modName.textContent = mod.modName || "Unnamed mod";
      modNameRow.appendChild(modName);

      // Select button
      const selectButton = document.createElement("button");
      selectButton.className = "mod-select-button";
      // Restore selection if this mod was previously selected for the current skin
      const isSelected = (selectedModId === modId || previousSelectedModId === modId) && 
                         selectedModSkinId === currentSkinData?.skinId;
      if (isSelected && previousSelectedModId === modId) {
        selectedModId = modId; // Restore the selection
        selectedModSkinId = currentSkinData?.skinId; // Restore the skin ID
      }
      selectButton.textContent = isSelected ? "Selected" : "Select";
      if (isSelected) {
        selectButton.classList.add("selected");
      }
      selectButton.addEventListener("click", (e) => {
        e.stopPropagation();
        handleModSelect(modId, selectButton, mod);
      });

      modNameRow.appendChild(selectButton);
      listItem.appendChild(modNameRow);

      // Store mod ID on list item for easy reference
      listItem.setAttribute("data-mod-id", modId);

      if (mod.description) {
        const modDesc = document.createElement("div");
        modDesc.className = "mod-description";
        modDesc.textContent = mod.description;
        listItem.appendChild(modDesc);
      }

      modList.appendChild(listItem);
    });
  }

  function updateMapsEntries(mapsList) {
    if (!panel || !panel._mapsList || !panel._mapsLoading) {
      return;
    }

    const mapsListEl = panel._mapsList;
    const loadingEl = panel._mapsLoading;
    
    mapsListEl.innerHTML = "";
    
    if (!mapsList || mapsList.length === 0) {
      loadingEl.textContent = "No maps found";
      loadingEl.style.display = "block";
      return;
    }

    loadingEl.style.display = "none";

    mapsList.forEach((map) => {
      const listItem = document.createElement("li");
      const mapId = map.id || map.name || `map-${Date.now()}-${Math.random()}`;

      // Create a row container for name and button
      const mapNameRow = document.createElement("div");
      mapNameRow.className = "mod-name-row";

      const mapName = document.createElement("div");
      mapName.className = "mod-name";
      mapName.textContent = map.name || "Unnamed map";
      mapNameRow.appendChild(mapName);

      const selectButton = document.createElement("button");
      selectButton.className = "mod-select-button";
      listItem.setAttribute("data-map-id", mapId);

      if (selectedMapId === mapId) {
        selectButton.textContent = "Selected";
        selectButton.classList.add("selected");
      } else {
        selectButton.textContent = "Select";
      }

      selectButton.addEventListener("click", (e) => {
        e.stopPropagation();
        handleMapSelect(mapId, selectButton, map);
      });

      mapNameRow.appendChild(selectButton);
      listItem.appendChild(mapNameRow);

      if (map.description) {
        const mapDesc = document.createElement("div");
        mapDesc.className = "mod-description";
        mapDesc.textContent = map.description;
        listItem.appendChild(mapDesc);
      }

      mapsListEl.appendChild(listItem);
    });
  }

  function updateFontsEntries(fontsList) {
    if (!panel || !panel._fontsList || !panel._fontsLoading) {
      return;
    }

    const fontsListEl = panel._fontsList;
    const loadingEl = panel._fontsLoading;
    
    fontsListEl.innerHTML = "";
    
    if (!fontsList || fontsList.length === 0) {
      loadingEl.textContent = "No fonts found";
      loadingEl.style.display = "block";
      return;
    }

    loadingEl.style.display = "none";

    fontsList.forEach((font) => {
      const listItem = document.createElement("li");
      const fontId = font.id || font.name || `font-${Date.now()}-${Math.random()}`;

      // Create a row container for name and button
      const fontNameRow = document.createElement("div");
      fontNameRow.className = "mod-name-row";

      const fontName = document.createElement("div");
      fontName.className = "mod-name";
      fontName.textContent = font.name || "Unnamed font";
      fontNameRow.appendChild(fontName);

      const selectButton = document.createElement("button");
      selectButton.className = "mod-select-button";
      listItem.setAttribute("data-font-id", fontId);

      if (selectedFontId === fontId) {
        selectButton.textContent = "Selected";
        selectButton.classList.add("selected");
      } else {
        selectButton.textContent = "Select";
      }

      selectButton.addEventListener("click", (e) => {
        e.stopPropagation();
        handleFontSelect(fontId, selectButton, font);
      });

      fontNameRow.appendChild(selectButton);
      listItem.appendChild(fontNameRow);

      if (font.description) {
        const fontDesc = document.createElement("div");
        fontDesc.className = "mod-description";
        fontDesc.textContent = font.description;
        listItem.appendChild(fontDesc);
      }

      fontsListEl.appendChild(listItem);
    });
  }

  function updateAnnouncersEntries(announcersList) {
    if (!panel || !panel._announcersList || !panel._announcersLoading) {
      return;
    }

    const announcersListEl = panel._announcersList;
    const loadingEl = panel._announcersLoading;
    
    announcersListEl.innerHTML = "";
    
    if (!announcersList || announcersList.length === 0) {
      loadingEl.textContent = "No announcers found";
      loadingEl.style.display = "block";
      return;
    }

    loadingEl.style.display = "none";

    announcersList.forEach((announcer) => {
      const listItem = document.createElement("li");
      const announcerId = announcer.id || announcer.name || `announcer-${Date.now()}-${Math.random()}`;

      // Create a row container for name and button
      const announcerNameRow = document.createElement("div");
      announcerNameRow.className = "mod-name-row";

      const announcerName = document.createElement("div");
      announcerName.className = "mod-name";
      announcerName.textContent = announcer.name || "Unnamed announcer";
      announcerNameRow.appendChild(announcerName);

      const selectButton = document.createElement("button");
      selectButton.className = "mod-select-button";
      listItem.setAttribute("data-announcer-id", announcerId);

      if (selectedAnnouncerId === announcerId) {
        selectButton.textContent = "Selected";
        selectButton.classList.add("selected");
      } else {
        selectButton.textContent = "Select";
      }

      selectButton.addEventListener("click", (e) => {
        e.stopPropagation();
        handleAnnouncerSelect(announcerId, selectButton, announcer);
      });

      announcerNameRow.appendChild(selectButton);
      listItem.appendChild(announcerNameRow);

      if (announcer.description) {
        const announcerDesc = document.createElement("div");
        announcerDesc.className = "mod-description";
        announcerDesc.textContent = announcer.description;
        listItem.appendChild(announcerDesc);
      }

      announcersListEl.appendChild(listItem);
    });
  }

  function handleMapSelect(mapId, buttonElement, mapData) {
    if (selectedMapId === mapId) {
      selectedMapId = null;
      buttonElement.textContent = "Select";
      buttonElement.classList.remove("selected");
      emit({ type: "select-map", mapId: null });
    } else {
      if (selectedMapId) {
        const previousButton = panel?._mapsList?.querySelector(
          `[data-map-id="${selectedMapId}"] .mod-select-button`
        );
        if (previousButton) {
          previousButton.textContent = "Select";
          previousButton.classList.remove("selected");
        }
      }
      selectedMapId = mapId;
      buttonElement.textContent = "Selected";
      buttonElement.classList.add("selected");
      emit({ type: "select-map", mapId, mapData });
    }
  }

  function handleFontSelect(fontId, buttonElement, fontData) {
    if (selectedFontId === fontId) {
      selectedFontId = null;
      buttonElement.textContent = "Select";
      buttonElement.classList.remove("selected");
      emit({ type: "select-font", fontId: null });
    } else {
      if (selectedFontId) {
        const previousButton = panel?._fontsList?.querySelector(
          `[data-font-id="${selectedFontId}"] .mod-select-button`
        );
        if (previousButton) {
          previousButton.textContent = "Select";
          previousButton.classList.remove("selected");
        }
      }
      selectedFontId = fontId;
      buttonElement.textContent = "Selected";
      buttonElement.classList.add("selected");
      emit({ type: "select-font", fontId, fontData });
    }
  }

  function handleAnnouncerSelect(announcerId, buttonElement, announcerData) {
    if (selectedAnnouncerId === announcerId) {
      selectedAnnouncerId = null;
      buttonElement.textContent = "Select";
      buttonElement.classList.remove("selected");
      emit({ type: "select-announcer", announcerId: null });
    } else {
      if (selectedAnnouncerId) {
        const previousButton = panel?._announcersList?.querySelector(
          `[data-announcer-id="${selectedAnnouncerId}"] .mod-select-button`
        );
        if (previousButton) {
          previousButton.textContent = "Select";
          previousButton.classList.remove("selected");
        }
      }
      selectedAnnouncerId = announcerId;
      buttonElement.textContent = "Selected";
      buttonElement.classList.add("selected");
      emit({ type: "select-announcer", announcerId, announcerData });
    }
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

  function findButtonLocation() {
    // Position button to the right of where random button would be (centered below skin, but to the right)
    const allItems = document.querySelectorAll(".skin-selection-item");
    for (const item of allItems) {
      if (item.classList.contains("skin-carousel-offset-2")) {
        const rect = item.getBoundingClientRect();
        // Position to the right of where random button would be (centered + 38px + 8px spacing)
        // Same Y level as random button (78px below skin item)
        return {
          x: rect.left + rect.width / 2 + 19 + 8, // Half width + random button width + spacing
          y: rect.top + 28, // Moved up to be above VIEW ABILITIES bar
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
        y: rect.top + 28, // Moved up to be above VIEW ABILITIES bar
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

    const location = findButtonLocation();
    if (!location) {
      return;
    }

    const targetContainer = findButtonContainer();
    if (!targetContainer) {
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

    // Calculate position relative to container
    const left = location.x - containerRect.left;
    const top = location.y - containerRect.top;

    // Position button absolutely within container - use setProperty to ensure it applies
    button.style.setProperty('position', 'absolute', 'important');
    button.style.setProperty('left', `${left}px`, 'important');
    button.style.setProperty('top', `${top}px`, 'important');
    button.style.setProperty('width', `${location.width}px`, 'important');
    button.style.setProperty('height', `${location.height}px`, 'important');
    button.style.zIndex = "1"; // Above random button (which is z-index 0)
    button.style.display = "block";
    button.style.visibility = "visible";
    button.style.opacity = "1";

    // Remove the default positioning classes that might interfere
    button.style.bottom = "";
    button.style.transform = "";
    button.style.margin = "0";
    button.style.padding = "0";

    targetContainer.appendChild(button);
    
    // Force browser to apply the position (after appending to DOM)
    void button.offsetHeight; // Trigger reflow

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

    // Calculate width first, then position
    if (panel._calculateWidth) {
      panel._calculateWidth();
    }
    
    // Initial positioning (will be repositioned after width is calculated)
    positionPanel(panel, button);

    // Force a reflow
    panel.offsetHeight;

    // Reposition after render and width calculation
    setTimeout(() => {
      // Recalculate width to ensure tabs are fully rendered
      if (panel._calculateWidth) {
        panel._calculateWidth();
      }
      // Position after width is set
      positionPanel(panel, button);
    }, 0);

    isOpen = true;
    
    // Update button pressed state
    if (button) {
      button.classList.add("pressed");
    }
    
    // Request data for all tabs when panel opens
    requestModsForCurrentSkin();
    requestMaps();
    requestFonts();
    requestAnnouncers();

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
      // Update button pressed state
      if (button) {
        button.classList.remove("pressed");
      }
      return;
    }
    // Hide panel but keep it in DOM for reuse
    if (panel.parentNode) {
      panel.style.display = "none";
      panel.style.pointerEvents = "none";
    }
    isOpen = false;
    
    // Update button pressed state
    if (button) {
      button.classList.remove("pressed");
    }
  }

  function requestModsForCurrentSkin() {
    const state = window.__roseSkinState || {};
    const championId = Number(state.championId);
    const skinId = Number(state.skinId);

    // Only reset selection if skin actually changed
    if (selectedModId && selectedModSkinId !== skinId) {
      // Skin changed, reset selection
      selectedModId = null;
      selectedModSkinId = null;
    }
    // If same skin, keep the selection

    if (!championId || !skinId) {
      if (panel && panel._modsLoading) {
        panel._modsLoading.textContent = "Hover a skin...";
        panel._modsLoading.style.display = "block";
      }
      return;
    }

    emit({ type: REQUEST_TYPE, championId, skinId });

    if (panel && panel._modsLoading) {
      panel._modsLoading.textContent = "Checking for mods…";
      panel._modsLoading.style.display = "block";
    }
  }

  // Request maps - global (not skin-specific)
  // Backend should look in: %LOCALAPPDATA%\Rose\mods\maps
  function requestMaps() {
    emit({ type: "request-maps" });
    if (panel && panel._mapsLoading) {
      panel._mapsLoading.textContent = "Loading maps…";
      panel._mapsLoading.style.display = "block";
    }
  }

  // Request fonts - global (not skin-specific)
  // Backend should look in: %LOCALAPPDATA%\Rose\mods\fonts
  function requestFonts() {
    emit({ type: "request-fonts" });
    if (panel && panel._fontsLoading) {
      panel._fontsLoading.textContent = "Loading fonts…";
      panel._fontsLoading.style.display = "block";
    }
  }

  // Request announcers - global (not skin-specific)
  // Backend should look in: %LOCALAPPDATA%\Rose\mods\announcers
  function requestAnnouncers() {
    emit({ type: "request-announcers" });
    if (panel && panel._announcersLoading) {
      panel._announcersLoading.textContent = "Loading announcers…";
      panel._announcersLoading.style.display = "block";
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

    // Store current skin data for selection restoration
    currentSkinData = { championId, skinId };
    
    // Only restore selection if it's for the same skin
    if (selectedModId && selectedModSkinId !== skinId) {
      // Skin changed, clear selection
      selectedModId = null;
      selectedModSkinId = null;
    }

    const mods = Array.isArray(detail.mods) ? detail.mods : [];
    updateModEntries(mods);
  }

  function handleMapsResponse(event) {
    if (!isOpen || activeTab !== "maps") {
      return;
    }

    const detail = event?.detail;
    if (!detail || detail.type !== "maps-response") {
      return;
    }

    const mapsList = Array.isArray(detail.maps) ? detail.maps : [];
    updateMapsEntries(mapsList);
  }

  function handleFontsResponse(event) {
    if (!isOpen || activeTab !== "fonts") {
      return;
    }

    const detail = event?.detail;
    if (!detail || detail.type !== "fonts-response") {
      return;
    }

    const fontsList = Array.isArray(detail.fonts) ? detail.fonts : [];
    updateFontsEntries(fontsList);
  }

  function handleAnnouncersResponse(event) {
    if (!isOpen || activeTab !== "announcers") {
      return;
    }

    const detail = event?.detail;
    if (!detail || detail.type !== "announcers-response") {
      return;
    }

    const announcersList = Array.isArray(detail.announcers) ? detail.announcers : [];
    updateAnnouncersEntries(announcersList);
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
    window.addEventListener("rose-custom-wheel-maps", handleMapsResponse, {
      passive: true,
    });
    window.addEventListener("rose-custom-wheel-fonts", handleFontsResponse, {
      passive: true,
    });
    window.addEventListener("rose-custom-wheel-announcers", handleAnnouncersResponse, {
      passive: true,
    });
    window.addEventListener(EVENT_LOCK_STATE, handleChampionLocked, {
      passive: true,
    });
    // Reposition button when skin changes
    const repositionButton = () => {
      if (button && button.parentNode && championLocked) {
        const location = findButtonLocation();
        if (location && button._container) {
          const containerRect = button._container.getBoundingClientRect();
          const newLeft = location.x - containerRect.left;
          const newTop = location.y - containerRect.top;
          button.style.setProperty('left', `${newLeft}px`, 'important');
          button.style.setProperty('top', `${newTop}px`, 'important');
          // Force browser to apply the position
          void button.offsetHeight; // Trigger reflow
        }
      }
      if (isOpen && panel && button) {
        positionPanel(panel, button);
      }
    };

    window.addEventListener("resize", repositionButton);
    window.addEventListener("scroll", repositionButton);
  });
})();
