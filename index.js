/**
 * @name ROSE-CustomWheel
 * @author Rose Team
 * @description Custom mod wheel for Pengu Loader - displays installed mods for hovered skins
 * @link https://github.com/Alban1911/ROSE-CustomWheel
 */
(function createCustomWheel() {
  const LOG_PREFIX = "[ROSE-CustomWheel]";
  console.log(`${LOG_PREFIX} JS Loaded`);
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
  let activeTab = "skins"; // Current active tab: "skins", "maps", "fonts", "announcers", "others"
  let selectedMapId = null;
  let selectedFontId = null;
  let selectedAnnouncerId = null;
  let selectedOtherId = null;
  let lastChampionSelectSession = null; // Track current champ select session
  let isFirstOpenInSession = true; // Track if this is first open in current session

  // WebSocket bridge for communication
  let BRIDGE_PORT = 50000;
  let BRIDGE_URL = `ws://127.0.0.1:${BRIDGE_PORT}`;
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
            const response = await fetch(`http://127.0.0.1:${port}/bridge-port`, {
              signal: AbortSignal.timeout(200),
            });
            if (response.ok) {
              const portText = await response.text();
              const fetchedPort = parseInt(portText.trim(), 10);
              if (!isNaN(fetchedPort) && fetchedPort > 0) {
                BRIDGE_PORT = fetchedPort;
                BRIDGE_URL = `ws://127.0.0.1:${BRIDGE_PORT}`;
                return true;
              }
            }
          } catch (e) {
            localStorage.removeItem(BRIDGE_PORT_STORAGE_KEY);
          }
        }
      }

      // OPTIMIZATION: Try default port 50000 FIRST before scanning all ports
      try {
        const response = await fetch(`http://127.0.0.1:50000/bridge-port`, {
          signal: AbortSignal.timeout(200),
        });
        if (response.ok) {
          const portText = await response.text();
          const fetchedPort = parseInt(portText.trim(), 10);
          if (!isNaN(fetchedPort) && fetchedPort > 0) {
            BRIDGE_PORT = fetchedPort;
            BRIDGE_URL = `ws://127.0.0.1:${BRIDGE_PORT}`;
            localStorage.setItem(BRIDGE_PORT_STORAGE_KEY, String(BRIDGE_PORT));
            return true;
          }
        }
      } catch (e) {
        // Port 50000 not ready, continue to discovery
      }

      // OPTIMIZATION: Try fallback port 50001 SECOND
      try {
        const response = await fetch(`http://127.0.0.1:50001/bridge-port`, {
          signal: AbortSignal.timeout(200),
        });
        if (response.ok) {
          const portText = await response.text();
          const fetchedPort = parseInt(portText.trim(), 10);
          if (!isNaN(fetchedPort) && fetchedPort > 0) {
            BRIDGE_PORT = fetchedPort;
            BRIDGE_URL = `ws://127.0.0.1:${BRIDGE_PORT}`;
            localStorage.setItem(BRIDGE_PORT_STORAGE_KEY, String(BRIDGE_PORT));
            return true;
          }
        }
      } catch (e) {
        // Port 50001 not ready, continue to discovery
      }

      // OPTIMIZATION: Parallel port discovery instead of sequential
      const portPromises = [];
      for (let port = DISCOVERY_START_PORT; port <= DISCOVERY_END_PORT; port++) {
        portPromises.push(
          fetch(`http://127.0.0.1:${port}/bridge-port`, {
            signal: AbortSignal.timeout(1000),
          })
            .then((response) => {
              if (response.ok) {
                return response.text().then((portText) => {
                  const fetchedPort = parseInt(portText.trim(), 10);
                  if (!isNaN(fetchedPort) && fetchedPort > 0) {
                    return { port: fetchedPort, sourcePort: port };
                  }
                  return null;
                });
              }
              return null;
            })
            .catch(() => null)
        );
      }

      // Wait for first successful response
      const results = await Promise.allSettled(portPromises);
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          BRIDGE_PORT = result.value.port;
          BRIDGE_URL = `ws://127.0.0.1:${BRIDGE_PORT}`;
          localStorage.setItem(BRIDGE_PORT_STORAGE_KEY, String(BRIDGE_PORT));
          return true;
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
        // Button no longer uses images - handled by League UI component
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

    /* Button and Badge Styles */
    lol-uikit-flat-button.rose-custom-wheel-button,
    .rose-custom-wheel-button {
      display: inline-block !important;
      white-space: nowrap !important;
    }

    .rose-custom-wheel-button .count-badge.social-count-badge,
    lol-uikit-flat-button.rose-custom-wheel-button .count-badge.social-count-badge,
    .rose-custom-wheel-button > .count-badge.social-count-badge,
    lol-uikit-flat-button.rose-custom-wheel-button > .count-badge.social-count-badge {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      min-width: 18px !important;
      height: 18px !important;
      padding: 0 5px !important;
      background: #c89b3c !important;
      color: #000 !important;
      border-radius: 3px !important;
      font-size: 11px !important;
      font-weight: 600 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      line-height: 1 !important;
      box-sizing: border-box !important;
      pointer-events: none !important;
      z-index: 10 !important;
      transform: translate(-170%, -70%) !important;
      margin: 0 !important;
      right: auto !important;
      bottom: auto !important;
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

    .${BUTTON_CLASS} .button-image.default { opacity: 1; }
    .${BUTTON_CLASS} .button-image.pressed { opacity: 0; background-color: transparent !important; border: none !important; }
    .${BUTTON_CLASS}.pressed .button-image.default { opacity: 0; }
    .${BUTTON_CLASS}.pressed .button-image.pressed { opacity: 1; }

    .chroma.icon { display: none !important; }

    /* Main Panel Container */
    .${PANEL_CLASS} {
      position: fixed;
      z-index: 10000;
      pointer-events: all;
      -webkit-user-select: none;
      font-family: "Spiegel", "LoL Body", Arial, sans-serif;
    }

    .${PANEL_CLASS}[data-no-button] {
      pointer-events: none;
      cursor: default !important;
    }

    /* Modal Content */
    .${PANEL_CLASS} .chroma-modal {
      background: #010a13;
      border-radius: 2px;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.8);
      display: flex;
      flex-direction: column;
      width: auto;
      min-width: 320px;
      position: relative;
      z-index: 0;
      padding: 16px;
      box-sizing: border-box;
      overflow: hidden;
      color: #f0e6d2;
      height: 400px !important;
      min-height: 400px !important;
      max-height: 400px !important;
    }
    
    .${PANEL_CLASS} .chroma-modal.chroma-view {
      /* Height handled in base class to ensure consistency */
      overflow: hidden;
    }

    /* Flyout Reset */
    .${PANEL_CLASS} .flyout {
      position: absolute;
      overflow: visible;
      pointer-events: all;
      -webkit-user-select: none;
      width: auto !important;
      filter: drop-shadow(0 0 10px rgba(0,0,0,0.5));
    }
    
    .${PANEL_CLASS} .flyout .caret,
    .${PANEL_CLASS} .flyout [class*="caret"],
    .${PANEL_CLASS} lol-uikit-flyout-frame .caret,
    .${PANEL_CLASS} lol-uikit-flyout-frame [class*="caret"],
    .${PANEL_CLASS} .flyout::part(caret),
    .${PANEL_CLASS} lol-uikit-flyout-frame::part(caret),
    .${PANEL_CLASS} lol-uikit-flyout-frame::before,
    .${PANEL_CLASS} lol-uikit-flyout-frame::after,
    .${PANEL_CLASS} .flyout::before,
    .${PANEL_CLASS} .flyout::after {
      display: none !important;
      visibility: hidden !important;
      content: none !important;
    }

    /* Tab Navigation */
    .${PANEL_CLASS} .tab-container {
      display: flex;
      justify-content: center;
      gap: 4px;
      margin-bottom: 12px;
      border-bottom: 2px solid #3c3c41;
      padding-top: 0;
      padding-bottom: 16px;
      width: 100%;
      flex-wrap: nowrap;
      flex-shrink: 0;
    }

    .${PANEL_CLASS} .tab-button {
      background: transparent;
      border: none;
      color: #a09b8c;
      padding: 8px 12px;
      cursor: pointer;
      font-family: inherit;
      font-weight: 700;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      transition: all 0.2s ease;
      position: relative;
      flex-shrink: 0;
      white-space: nowrap;
    }

    .${PANEL_CLASS} .tab-button:hover {
      color: #f0e6d2;
      background: rgba(255, 255, 255, 0.05);
    }

    .${PANEL_CLASS} .tab-button.active {
      color: #f0e6d2;
    }

    .${PANEL_CLASS} .tab-button.active::after {
      content: '';
      position: absolute;
      bottom: -2px;
      left: 0;
      width: 100%;
      height: 2px;
      background: #c8aa6e;
      box-shadow: 0 0 8px #c8aa6e;
    }

    .${PANEL_CLASS} .tab-content {
      display: none;
      width: 100%;
      background: transparent;
    }

    .${PANEL_CLASS} .tab-content.active {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    /* Mod List Content */
    .${PANEL_CLASS} .mod-selection {
      pointer-events: all;
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding-right: 4px;
      margin-top: 4px;
    }

    /* Scrollbar */
    .${PANEL_CLASS} .mod-selection::-webkit-scrollbar {
      width: 6px;
    }
    .${PANEL_CLASS} .mod-selection::-webkit-scrollbar-track {
      background: rgba(0,0,0,0.3);
    }
    .${PANEL_CLASS} .mod-selection::-webkit-scrollbar-thumb {
      background: #5b5a56;
      border-radius: 3px;
    }

    .${PANEL_CLASS} .mod-selection ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    /* List Items */
    .${PANEL_CLASS} .mod-selection li {
      background: linear-gradient(to right, rgba(30, 35, 40, 0.9), rgba(30, 35, 40, 0.6));
      border: 1px solid #3c3c41;
      border-left: 3px solid transparent;
      padding: 10px;
      transition: all 0.2s ease;
      display: flex;
      flex-direction: column;
      gap: 4px;
      border-radius: 0;
    }

    .${PANEL_CLASS} .mod-selection li:hover {
      background: linear-gradient(to right, rgba(40, 45, 50, 0.9), rgba(40, 45, 50, 0.7));
      border-color: #5c5c61;
      border-left-color: #c8aa6e;
      transform: translateX(2px);
    }

    .${PANEL_CLASS} .mod-name-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
    }
    
    .${PANEL_CLASS} .mod-name {
      color: #f0e6d2;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.5px;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .${PANEL_CLASS} .mod-description {
      color: #a09b8c;
      font-size: 11px;
      font-weight: 400;
      line-height: 1.4;
      word-wrap: break-word;
    }

    .${PANEL_CLASS} .mod-meta, 
    .${PANEL_CLASS} .mod-injection-note {
      color: #7a7a7d;
      font-size: 10px;
      font-style: italic;
    }

    .${PANEL_CLASS} .mod-loading {
      color: #a09b8c;
      font-size: 12px;
      text-align: center;
      padding: 20px;
      font-style: italic;
    }

    /* Action Buttons */
    .${PANEL_CLASS} .mod-select-button {
      background: transparent;
      border: 1px solid #c8aa6e;
      color: #c8aa6e;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.2s;
      flex-shrink: 0;
      border-radius: 0;
    }

    .${PANEL_CLASS} .mod-select-button:hover {
      background: rgba(200, 170, 110, 0.1);
      box-shadow: 0 0 8px rgba(200, 170, 110, 0.2);
    }

    .${PANEL_CLASS} .mod-select-button.selected {
      background: #c8aa6e;
      color: #010a13;
      box-shadow: 0 0 10px rgba(200, 170, 110, 0.4);
      border-color: #c8aa6e;
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

    try {
      button = document.createElement("lol-uikit-flat-button");
    } catch (e) {
      button = document.createElement("div");
    }
    button.className = "lol-uikit-flat-button idle rose-custom-wheel-button";
    button.textContent = "Custom mods";

    // Ensure button has relative positioning for badge (only if not already positioned)
    const computedStyle = window.getComputedStyle(button);
    if (computedStyle.position === "static" || computedStyle.position === "") {
      button.style.position = "relative";
    }

    // Create count badge
    const countBadge = document.createElement("div");
    countBadge.className = "count-badge social-count-badge";
    countBadge.textContent = "0";
    countBadge.style.display = "none"; // Hidden by default
    countBadge.style.position = "absolute";
    countBadge.style.top = "0";
    countBadge.style.left = "0";
    countBadge.style.transform = "translate(-70%, -50%)";
    button.appendChild(countBadge);
    button._countBadge = countBadge; // Store reference

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
    modal.className = "champ-select-chroma-modal chroma-modal chroma-view ember-view";

    // Header Decoration removed as per user request

    // Tab container
    const tabContainer = document.createElement("div");
    tabContainer.className = "tab-container";

    // Create tabs using League UI components
    const modsTab = document.createElement("lol-uikit-flat-button");
    modsTab.className = "lol-uikit-flat-button idle tab-button active";
    modsTab.textContent = "Skins";
    modsTab.dataset.tab = "skins";

    const mapsTab = document.createElement("lol-uikit-flat-button");
    mapsTab.className = "lol-uikit-flat-button idle tab-button";
    mapsTab.textContent = "Maps";
    mapsTab.dataset.tab = "maps";

    const fontsTab = document.createElement("lol-uikit-flat-button");
    fontsTab.className = "lol-uikit-flat-button idle tab-button";
    fontsTab.textContent = "Fonts";
    fontsTab.dataset.tab = "fonts";

    const announcersTab = document.createElement("lol-uikit-flat-button");
    announcersTab.className = "lol-uikit-flat-button idle tab-button";
    announcersTab.textContent = "Announcers";
    announcersTab.dataset.tab = "announcers";

    const othersTab = document.createElement("lol-uikit-flat-button");
    othersTab.className = "lol-uikit-flat-button idle tab-button";
    othersTab.textContent = "Others";
    othersTab.dataset.tab = "others";

    // Tab click handlers
    const switchTab = (tabName) => {
      activeTab = tabName;
      // Update tab buttons
      [modsTab, mapsTab, fontsTab, announcersTab, othersTab].forEach(tab => {
        if (tab.dataset.tab === tabName) {
          tab.classList.add("active");
        } else {
          tab.classList.remove("active");
        }
      });
      // Update tab content
      [panel._modsContent, panel._mapsContent, panel._fontsContent, panel._announcersContent, panel._othersContent].forEach(content => {
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
      } else if (tabName === "others") {
        requestOthers();
      }
    };

    modsTab.addEventListener("click", (e) => {
      e.stopPropagation();
      switchTab("skins");
    });
    mapsTab.addEventListener("click", (e) => {
      e.stopPropagation();
      switchTab("maps");
    });
    fontsTab.addEventListener("click", (e) => {
      e.stopPropagation();
      switchTab("fonts");
    });
    announcersTab.addEventListener("click", (e) => {
      e.stopPropagation();
      switchTab("announcers");
    });
    othersTab.addEventListener("click", (e) => {
      e.stopPropagation();
      switchTab("others");
    });

    tabContainer.appendChild(modsTab);
    tabContainer.appendChild(mapsTab);
    tabContainer.appendChild(fontsTab);
    tabContainer.appendChild(announcersTab);
    tabContainer.appendChild(othersTab);

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

    const othersContent = document.createElement("div");
    othersContent.className = "tab-content";
    othersContent.dataset.tab = "others";

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

    const othersList = document.createElement("ul");
    othersList.style.listStyle = "none";
    othersList.style.margin = "0";
    othersList.style.padding = "0";
    othersList.style.display = "flex";
    othersList.style.flexDirection = "column";
    othersList.style.width = "100%";
    othersList.style.gap = "4px";

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

    const othersLoading = document.createElement("div");
    othersLoading.className = "mod-loading";
    othersLoading.textContent = "Loading others…";
    othersLoading.style.display = "none";

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

    othersContent.appendChild(othersLoading);
    othersContent.appendChild(othersList);

    // Add tab content to scrollable (tabs stay fixed outside)
    scrollable.appendChild(modsContent);
    scrollable.appendChild(mapsContent);
    scrollable.appendChild(fontsContent);
    scrollable.appendChild(announcersContent);
    scrollable.appendChild(othersContent);

    // Add tab container and scrollable to modal (tabs outside scrollable)
    modal.appendChild(tabContainer);
    modal.appendChild(scrollable);
    flyoutContent.appendChild(modal);
    flyoutFrame.appendChild(flyoutContent);
    panel.appendChild(flyoutFrame);

    // Remove arrow/caret at the bottom
    setTimeout(() => {
      const carets = flyoutFrame.querySelectorAll('.caret, [class*="caret"]');
      carets.forEach(caret => {
        if (caret && caret.parentNode) {
          caret.style.display = 'none';
          caret.style.visibility = 'hidden';
        }
      });
      // Also try to remove via shadow DOM if it's a custom element
      if (flyoutFrame.shadowRoot) {
        const shadowCarets = flyoutFrame.shadowRoot.querySelectorAll('.caret, [class*="caret"]');
        shadowCarets.forEach(caret => {
          if (caret) {
            caret.style.display = 'none';
            caret.style.visibility = 'hidden';
          }
        });
      }
    }, 100);

    // Store references
    panel._modList = modList;
    panel._mapsList = mapsList;
    panel._fontsList = fontsList;
    panel._announcersList = announcersList;
    panel._othersList = othersList;
    panel._modsLoading = modsLoading;
    panel._mapsLoading = mapsLoading;
    panel._fontsLoading = fontsLoading;
    panel._announcersLoading = announcersLoading;
    panel._othersLoading = othersLoading;
    panel._modsContent = modsContent;
    panel._mapsContent = mapsContent;
    panel._fontsContent = fontsContent;
    panel._announcersContent = announcersContent;
    panel._othersContent = othersContent;
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
        // Add buffer for padding (16px*2) and border (2px*2) to ensure perfect fit
        modal.style.width = `${totalTabWidth + 36}px`;
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
          flyoutRect = { width: modalRect.width, height: flyoutRect.height || 400 };
        } else {
          // Fallback: use button width + estimated padding
          flyoutRect = { width: rect.width + 32, height: 400 };
        }
      } else {
        // Fallback: use button width + estimated padding
        flyoutRect = { width: rect.width + 32, height: 400 };
      }
    }

    // Center panel in the middle of the screen
    const centerX = (window.innerWidth - flyoutRect.width) / 2;
    const centerY = (window.innerHeight - flyoutRect.height) / 2;

    flyoutFrame.style.position = "fixed";
    flyoutFrame.style.overflow = "visible";
    flyoutFrame.style.top = `${centerY}px`;
    flyoutFrame.style.left = `${centerX}px`;
    flyoutFrame.style.right = ""; // Clear right when using left
    flyoutFrame.style.transform = ""; // Remove transform to avoid blur

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
      loadingEl.textContent = "No skins found";
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
      // Check if this mod is selected for the current skin
      // updateModEntries is always called with mods for the current skin
      const currentSkinId = currentSkinData?.skinId;
      const modIdMatches = (selectedModId === modId || previousSelectedModId === modId);

      // Check if skin matches (handle both Number and string comparisons)
      let skinMatches = false;
      if (currentSkinId !== undefined && selectedModSkinId !== null && selectedModSkinId !== undefined) {
        const currentSkinIdNum = Number(currentSkinId);
        const selectedSkinIdNum = Number(selectedModSkinId);
        skinMatches = currentSkinIdNum === selectedSkinIdNum;
      } else if (previousSelectedModId === modId && currentSkinId !== undefined) {
        // If this was previously selected and we have current skin data, assume it matches
        skinMatches = true;
      }

      const isSelected = modIdMatches && (skinMatches || (previousSelectedModId === modId && currentSkinId !== undefined));

      // Restore selection state if this was previously selected for current skin
      if (previousSelectedModId === modId && selectedModId !== modId && currentSkinId !== undefined) {
        selectedModId = modId;
        selectedModSkinId = Number(currentSkinId);
      }
      // Ensure selectedModSkinId is set correctly if mod is selected but skin ID is missing
      if (selectedModId === modId && currentSkinId !== undefined && (selectedModSkinId === null || selectedModSkinId === undefined)) {
        selectedModSkinId = Number(currentSkinId);
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

  function updateOthersEntries(othersList) {
    if (!panel || !panel._othersList || !panel._othersLoading) {
      return;
    }

    const othersListEl = panel._othersList;
    const loadingEl = panel._othersLoading;

    othersListEl.innerHTML = "";

    if (!othersList || othersList.length === 0) {
      loadingEl.textContent = "No other mods found";
      loadingEl.style.display = "block";
      return;
    }

    loadingEl.style.display = "none";

    othersList.forEach((other) => {
      const listItem = document.createElement("li");
      const otherId = other.id || other.name || `other-${Date.now()}-${Math.random()}`;

      // Create a row container for name and button
      const otherNameRow = document.createElement("div");
      otherNameRow.className = "mod-name-row";

      const otherName = document.createElement("div");
      otherName.className = "mod-name";
      otherName.textContent = other.name || "Unnamed other";
      otherNameRow.appendChild(otherName);

      const selectButton = document.createElement("button");
      selectButton.className = "mod-select-button";
      listItem.setAttribute("data-other-id", otherId);

      if (selectedOtherId === otherId) {
        selectButton.textContent = "Selected";
        selectButton.classList.add("selected");
      } else {
        selectButton.textContent = "Select";
      }

      selectButton.addEventListener("click", (e) => {
        e.stopPropagation();
        handleOtherSelect(otherId, selectButton, other);
      });

      otherNameRow.appendChild(selectButton);
      listItem.appendChild(otherNameRow);

      if (other.description) {
        const otherDesc = document.createElement("div");
        otherDesc.className = "mod-description";
        otherDesc.textContent = other.description;
        listItem.appendChild(otherDesc);
      }

      othersListEl.appendChild(listItem);
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

  function handleOtherSelect(otherId, buttonElement, otherData) {
    if (selectedOtherId === otherId) {
      selectedOtherId = null;
      buttonElement.textContent = "Select";
      buttonElement.classList.remove("selected");
      emit({ type: "select-other", otherId: null });
    } else {
      if (selectedOtherId) {
        const previousButton = panel?._othersList?.querySelector(
          `[data-other-id="${selectedOtherId}"] .mod-select-button`
        );
        if (previousButton) {
          previousButton.textContent = "Select";
          previousButton.classList.remove("selected");
        }
      }
      selectedOtherId = otherId;
      buttonElement.textContent = "Selected";
      buttonElement.classList.add("selected");
      emit({ type: "select-other", otherId, otherData });
    }
  }

  function findButtonContainer() {
    // Find the bottom-right-buttons container to position the button above it
    return document.querySelector(".bottom-right-buttons");
  }

  function attachToChampionSelect() {
    if (!championSelectRoot || !championLocked) {
      return;
    }

    createButton();
    createPanel();

    const targetContainer = findButtonContainer();
    if (!targetContainer) {
      // Retry after a short delay if container not found (DOM might not be ready)
      setTimeout(() => {
        if (championLocked && championSelectRoot) {
          const retryContainer = findButtonContainer();
          if (retryContainer) {
            attachToChampionSelect();
          }
        }
      }, 100);
      return;
    }

    // Remove button from old parent if it exists
    if (button.parentNode) {
      button.parentNode.removeChild(button);
    }

    // Ensure container has relative positioning for absolute child
    const containerStyles = window.getComputedStyle(targetContainer);
    if (containerStyles.position === "static") {
      targetContainer.style.position = "relative";
    }

    // Position button absolutely above the container buttons
    button.style.position = "absolute";
    button.style.right = "0"; // Align with right edge of container
    button.style.bottom = "100%"; // Position above container
    button.style.marginBottom = "10px"; // 10px spacing above buttons
    button.style.left = "";
    button.style.top = "";
    button.style.width = "auto";
    button.style.height = "auto";
    button.style.padding = "";
    button.style.display = "block";
    button.style.visibility = "visible";
    button.style.opacity = "1";
    button.style.zIndex = "";
    button.style.transform = "";

    // Ensure badge positioning works - button needs to be relative for badge absolute positioning
    // But we need absolute for button positioning, so we'll use a wrapper or ensure badge uses button as reference
    // Actually, absolute children can still position relative to absolute parents, so this should work

    // Append to container (same structure as QUIT button)
    targetContainer.appendChild(button);

    // Store reference to container for repositioning
    button._container = targetContainer;

    // Force badge positioning after button is attached
    if (button._countBadge) {
      const badge = button._countBadge;
      badge.style.position = "absolute";
      badge.style.top = "0";
      badge.style.left = "0";
      badge.style.transform = "translate(-170%, -70%)";
      badge.style.zIndex = "10";
    }

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
      // Even if target is the same, check if button needs to be attached
      if (championLocked && target && (!button || !button.parentNode)) {
        refreshUIVisibility();
      }
      return;
    }
    // New champion select detected - reset session tracking
    if (target && target !== championSelectRoot) {
      lastChampionSelectSession = target;
      isFirstOpenInSession = true;
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

    // Only switch to Skins tab on first open in this champ select session
    // Otherwise, keep the last selected tab
    if (isFirstOpenInSession) {
      activeTab = "skins";
      isFirstOpenInSession = false;
    }

    const modsTab = panel.querySelector('.tab-button[data-tab="skins"]');
    const mapsTab = panel.querySelector('.tab-button[data-tab="maps"]');
    const fontsTab = panel.querySelector('.tab-button[data-tab="fonts"]');
    const announcersTab = panel.querySelector('.tab-button[data-tab="announcers"]');
    const othersTab = panel.querySelector('.tab-button[data-tab="others"]');

    // Update tab buttons based on activeTab
    [modsTab, mapsTab, fontsTab, announcersTab, othersTab].forEach(tab => {
      if (tab && tab.dataset.tab === activeTab) {
        tab.classList.add("active");
      } else if (tab) {
        tab.classList.remove("active");
      }
    });

    // Update tab content based on activeTab
    [panel._modsContent, panel._mapsContent, panel._fontsContent, panel._announcersContent, panel._othersContent].forEach(content => {
      if (content) {
        if (content.dataset.tab === activeTab) {
          content.classList.add("active");
        } else {
          content.classList.remove("active");
        }
      }
    });

    // Request data for the active tab
    if (activeTab === "skins") {
      requestModsForCurrentSkin();
    } else if (activeTab === "maps") {
      requestMaps();
    } else if (activeTab === "fonts") {
      requestFonts();
    } else if (activeTab === "announcers") {
      requestAnnouncers();
    } else if (activeTab === "others") {
      requestOthers();
    }

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

    // Request data for all tabs when panel opens (in background, but don't switch to them)
    requestModsForCurrentSkin();
    requestMaps();
    requestFonts();
    requestAnnouncers();
    requestOthers();

    // Add click outside handler
    const closeHandler = (e) => {
      // Check if click is on a tab button (they might be custom elements)
      const clickedTab = e.target.closest(".tab-button");
      if (clickedTab) {
        return; // Don't close if clicking on a tab
      }

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

    // Clear all selections when panel closes
    selectedModId = null;
    selectedModSkinId = null;
    selectedMapId = null;
    selectedFontId = null;
    selectedAnnouncerId = null;
    selectedOtherId = null;
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
      // Reset badge when no skin is hovered
      updateButtonBadge(0);
      if (panel && panel._modsLoading) {
        panel._modsLoading.textContent = "Hover a skin...";
        panel._modsLoading.style.display = "block";
      }
      return;
    }

    // Reset badge immediately when requesting mods for a new skin
    // This ensures the badge doesn't show stale data while waiting for response
    const previousSkinId = currentSkinData?.skinId;
    if (previousSkinId !== undefined && previousSkinId !== skinId) {
      updateButtonBadge(0);
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

  // Request others - global (not skin-specific)
  // Backend should look in: %LOCALAPPDATA%\Rose\mods\others
  function requestOthers() {
    emit({ type: "request-others" });
    if (panel && panel._othersLoading) {
      panel._othersLoading.textContent = "Loading others…";
      panel._othersLoading.style.display = "block";
    }
  }

  function handleSkinState(event) {
    // Always request mods to update badge, even if panel is not open
    requestModsForCurrentSkin();

    if (!isOpen) {
      return;
    }
  }

  function updateButtonBadge(count) {
    if (!button || !button._countBadge) {
      return;
    }
    const badge = button._countBadge;
    // Ensure badge positioning is always correct
    badge.style.position = "absolute";
    badge.style.top = "0";
    badge.style.left = "0";
    badge.style.transform = "translate(-170%, -70%)";
    badge.style.zIndex = "10";

    if (count > 0) {
      badge.textContent = String(count);
      badge.style.display = "flex"; // Explicitly set to flex to match CSS
    } else {
      badge.textContent = "0"; // Reset text content
      badge.style.display = "none";
    }
  }

  function handleModsResponse(event) {
    const detail = event?.detail;
    if (!detail || detail.type !== "skin-mods-response") {
      return;
    }

    const championId = Number(detail?.championId);
    const skinId = Number(detail?.skinId);
    if (!championId || !skinId) {
      updateButtonBadge(0);
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

    // Update button badge with mod count
    updateButtonBadge(mods.length);

    if (!isOpen) {
      return;
    }

    // Check for historic mod and auto-select it
    const historicMod = detail.historicMod;
    if (historicMod && !selectedModId) {
      // Find the mod that matches the historic path
      const historicModEntry = mods.find(mod => {
        const modPath = mod.relativePath || "";
        // Normalize paths for comparison
        return modPath.replace(/\\/g, "/") === historicMod.replace(/\\/g, "/");
      });

      if (historicModEntry) {
        // Use the same ID format as updateModEntries uses
        const modId = historicModEntry.relativePath || historicModEntry.modName || `mod-${Date.now()}-${Math.random()}`;
        selectedModId = modId;
        selectedModSkinId = skinId;
      }
    }

    updateModEntries(mods);

    // After UI is updated, emit selection to backend if historic mod was found
    if (historicMod && selectedModId) {
      const historicModEntry = mods.find(mod => {
        const modPath = mod.relativePath || mod.modName || "";
        return modPath === selectedModId || mod.relativePath === selectedModId;
      });
      if (historicModEntry) {
        // Find the button and update it, then emit
        const button = panel?._modList?.querySelector(
          `[data-mod-id="${selectedModId}"] .mod-select-button`
        );
        if (button) {
          button.textContent = "Selected";
          button.classList.add("selected");
        }
        emit({ type: "select-skin-mod", championId, skinId, modId: selectedModId, modData: historicModEntry });
      }
    }
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

    // Check for historic mod and auto-select it
    const historicMod = detail.historicMod;
    if (historicMod && !selectedMapId) {
      // Find the mod that matches the historic path
      // historicMod is the relative path (e.g., "maps/default-summoner-rift_1.0.1")
      // map.id is also the relative path
      const historicMap = mapsList.find(map => {
        const mapId = map.id || "";
        // Normalize paths for comparison
        return mapId.replace(/\\/g, "/") === historicMod.replace(/\\/g, "/");
      });

      if (historicMap) {
        // Use the same ID format as updateMapsEntries uses
        const mapId = historicMap.id || historicMap.name || `map-${Date.now()}-${Math.random()}`;
        selectedMapId = mapId;
      }
    }

    updateMapsEntries(mapsList);

    // After UI is updated, emit selection to backend if historic mod was found
    if (historicMod && selectedMapId) {
      const historicMap = mapsList.find(map => {
        const mapId = map.id || map.name || `map-${Date.now()}-${Math.random()}`;
        return mapId === selectedMapId;
      });
      if (historicMap) {
        // Find the button and update it, then emit
        const button = panel?._mapsList?.querySelector(
          `[data-map-id="${selectedMapId}"] .mod-select-button`
        );
        if (button) {
          button.textContent = "Selected";
          button.classList.add("selected");
        }
        emit({ type: "select-map", mapId: selectedMapId, mapData: historicMap });
      }
    }
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

    // Check for historic mod and auto-select it
    const historicMod = detail.historicMod;
    if (historicMod && !selectedFontId) {
      // Find the mod that matches the historic path
      const historicFont = fontsList.find(font => {
        const fontId = font.id || "";
        // Normalize paths for comparison
        return fontId.replace(/\\/g, "/") === historicMod.replace(/\\/g, "/");
      });

      if (historicFont) {
        const fontId = historicFont.id || historicFont.name || `font-${Date.now()}-${Math.random()}`;
        selectedFontId = fontId;
      }
    }

    updateFontsEntries(fontsList);

    // After UI is updated, emit selection to backend if historic mod was found
    if (historicMod && selectedFontId) {
      const historicFont = fontsList.find(font => {
        const fontId = font.id || font.name || `font-${Date.now()}-${Math.random()}`;
        return fontId === selectedFontId;
      });
      if (historicFont) {
        // Find the button and update it, then emit
        const button = panel?._fontsList?.querySelector(
          `[data-font-id="${selectedFontId}"] .mod-select-button`
        );
        if (button) {
          button.textContent = "Selected";
          button.classList.add("selected");
        }
        emit({ type: "select-font", fontId: selectedFontId, fontData: historicFont });
      }
    }
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

    // Check for historic mod and auto-select it
    const historicMod = detail.historicMod;
    if (historicMod && !selectedAnnouncerId) {
      // Find the mod that matches the historic path
      const historicAnnouncer = announcersList.find(announcer => {
        const announcerId = announcer.id || "";
        // Normalize paths for comparison
        return announcerId.replace(/\\/g, "/") === historicMod.replace(/\\/g, "/");
      });

      if (historicAnnouncer) {
        const announcerId = historicAnnouncer.id || historicAnnouncer.name || `announcer-${Date.now()}-${Math.random()}`;
        selectedAnnouncerId = announcerId;
      }
    }

    updateAnnouncersEntries(announcersList);

    // After UI is updated, emit selection to backend if historic mod was found
    if (historicMod && selectedAnnouncerId) {
      const historicAnnouncer = announcersList.find(announcer => {
        const announcerId = announcer.id || announcer.name || `announcer-${Date.now()}-${Math.random()}`;
        return announcerId === selectedAnnouncerId;
      });
      if (historicAnnouncer) {
        // Find the button and update it, then emit
        const button = panel?._announcersList?.querySelector(
          `[data-announcer-id="${selectedAnnouncerId}"] .mod-select-button`
        );
        if (button) {
          button.textContent = "Selected";
          button.classList.add("selected");
        }
        emit({ type: "select-announcer", announcerId: selectedAnnouncerId, announcerData: historicAnnouncer });
      }
    }
  }

  function handleOthersResponse(event) {
    if (!isOpen || activeTab !== "others") {
      return;
    }

    const detail = event?.detail;
    if (!detail || detail.type !== "others-response") {
      return;
    }

    const othersList = Array.isArray(detail.others) ? detail.others : [];

    // Check for historic mod and auto-select it
    const historicMod = detail.historicMod;
    if (historicMod && !selectedOtherId) {
      // Find the mod that matches the historic path
      const historicOther = othersList.find(other => {
        const otherId = other.id || "";
        // Normalize paths for comparison
        return otherId.replace(/\\/g, "/") === historicMod.replace(/\\/g, "/");
      });

      if (historicOther) {
        const otherId = historicOther.id || historicOther.name || `other-${Date.now()}-${Math.random()}`;
        selectedOtherId = otherId;
      }
    }

    updateOthersEntries(othersList);

    // After UI is updated, emit selection to backend if historic mod was found
    if (historicMod && selectedOtherId) {
      const historicOther = othersList.find(other => {
        const otherId = other.id || other.name || `other-${Date.now()}-${Math.random()}`;
        return otherId === selectedOtherId;
      });
      if (historicOther) {
        // Find the button and update it, then emit
        const button = panel?._othersList?.querySelector(
          `[data-other-id="${selectedOtherId}"] .mod-select-button`
        );
        if (button) {
          button.textContent = "Selected";
          button.classList.add("selected");
        }
        emit({ type: "select-other", otherId: selectedOtherId, otherData: historicOther });
      }
    }
  }

  function handleChampionLocked(event) {
    const locked = Boolean(event?.detail?.locked);
    if (locked === championLocked) {
      // Even if state is the same, ensure button is attached if it should be
      if (locked && championSelectRoot && (!button || !button.parentNode)) {
        refreshUIVisibility();
      }
      return;
    }

    // If a new champion is being locked, clear all selections and reset session
    if (locked && !championLocked) {
      selectedModId = null;
      selectedModSkinId = null;
      selectedMapId = null;
      selectedFontId = null;
      selectedAnnouncerId = null;
      selectedOtherId = null;
      // New champ select session - reset to first open
      lastChampionSelectSession = championSelectRoot;
      isFirstOpenInSession = true;
    }

    championLocked = locked;
    refreshUIVisibility();

    // Additional retry after lock state changes to ensure button appears
    if (locked) {
      setTimeout(() => {
        if (championLocked && championSelectRoot && (!button || !button.parentNode)) {
          refreshUIVisibility();
        }
      }, 200);
    }
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
    window.addEventListener("rose-custom-wheel-others", handleOthersResponse, {
      passive: true,
    });
    window.addEventListener(EVENT_LOCK_STATE, handleChampionLocked, {
      passive: true,
    });
    // Reposition button when skin changes
    const repositionButton = () => {
      // Button is now part of container flow, so no manual repositioning needed
      // Just check if button needs to be reattached
      if (button && !button.parentNode && championLocked) {
        attachToChampionSelect();
      }
      // Reposition panel if it's open
      if (isOpen && panel && button) {
        positionPanel(panel, button);
      }
    };

    window.addEventListener("resize", repositionButton);
    window.addEventListener("scroll", repositionButton);

    // Periodic check to ensure button is attached on first champion select
    // This handles cases where events fire before DOM is ready
    let attachmentCheckInterval = setInterval(() => {
      if (championLocked && championSelectRoot) {
        if (!button || !button.parentNode) {
          refreshUIVisibility();
        } else {
          // Button is attached, stop checking
          clearInterval(attachmentCheckInterval);
        }
      }
    }, 500);

    // Stop checking after 10 seconds to avoid infinite checking
    setTimeout(() => {
      clearInterval(attachmentCheckInterval);
    }, 10000);
  });
})();
