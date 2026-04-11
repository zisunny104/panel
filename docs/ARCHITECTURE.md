# Node.js 伺服器重構版本 架構藍圖

## 專案概述

### 整體架構圖

```
┌─────────────────────────────────────────────────────────────┐
│                    前端應用 (Browser)                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  資料層 (Frontend Storage)                           │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐    │   │
│  │  │localStorage│  │ IndexedDB  │  │sessionStorage   │   │
│  │  │(實驗狀態)  │  │(實驗日誌)  │  │ (分頁狀態) │    │   │
│  │  └────────────┘  └────────────┘  └────────────┘    │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  業務層 (Business Logic)                             │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────┐   │   │
│  │  │PageManager  │  │SyncManager  │  │Experiment│   │   │
│  │  │  (初始化)   │  │(工作階段)   │  │  Manager │   │   │
│  │  │             │  │             │  │           │   │   │
│  │  └─────────────┘  └─────────────┘  └──────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  通訊層 (Communication)                              │   │
│  │  ┌──────────────┐  ┌──────────────┐                │   │
│  │  │ WebSocket    │  │  HTTP HEAD   │                │   │
│  │  │   Client     │  │(/api/health  │                │   │
│  │  │              │  │  心跳 30s)   │                │   │
│  │  └──────────────┘  └──────────────┘                │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       │ WebSocket (ws://localhost:7645)
                       │ HTTP (http://localhost:7645)
┌──────────────────────┴──────────────────────────────────────┐
│            Node.js 伺服器 (Express + WebSocket)              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  HTTP 層                                             │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐         │   │
│  │  │  /health │  │ /static  │  │   CORS   │         │   │
│  │  └──────────┘  └──────────┘  └──────────┘         │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  WebSocket 層                                        │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────┐  │   │
│  │  │ Connection   │  │   Session    │  │Broadcast│  │   │
│  │  │   Manager    │  │   Manager    │  │ Manager │  │   │
│  │  └──────────────┘  └──────────────┘  └─────────┘  │   │
│  │  - 連線管理         - 工作階段管理    - 狀態廣播    │   │
│  │  - 心跳機制         - 客戶端角色      - 實驗同步    │   │
│  │  - 重連機制         - 校時服務                      │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  資料層 (SQLite)                                     │   │
│  │  - sessions (工作階段)                               │   │
│  │  - share_codes (分享代碼)                            │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 目錄結構與檔案詳解

### server/ - Node.js 後端

```
server/
├── index.js                 # 主入口：Express + WebSocket 伺服器初始化
├── metrics.js               # 性能監控與度量統計
├── package.json             # 依賴管理
├── .env                              # 環境變數設定（運行時）
├── .env.example                      # 環境變數範例（版本控制）
├── config/
│   ├── server.js             # 伺服器設定（連接埠、CORS、WebSocket、工作階段、速率限制）
│   ├── database.js           # SQLite 連線設定與 PRAGMA 優化
│   └── constants.js          # 常數定義（超時、限制等）
├── database/
│   ├── connection.js        # node:sqlite DatabaseSync 實例
│   └── schema.js            # 資料庫表結構初始化
├── services/
│   ├── SessionService.js    # 工作階段管理（CRUD + 校時）
│   ├── ShareCodeService.js  # 分享代碼管理（產生、驗證、校驗碼）
│   ├── ExperimentService.js # 實驗 ID 管理
│   └── LogService.js        # 日誌服務（檔案 I/O）
├── websocket/
│   ├── WSServer.js          # WebSocket 伺服器核心封裝
│   ├── ConnectionManager.js # 連線管理（clientId 對應、重連偵測）
│   ├── SessionManager.js    # 工作階段管理（房間管理）
│   ├── BroadcastManager.js  # 廣播管理（單播、房間廣播、全域廣播）
│   └── MessageHandler.js    # 訊息處理器（auth、heartbeat、state_update）
├── routes/
│   ├── sync.js              # 同步 API（工作階段、分享代碼、驗證）
│   ├── experiment-logs.js   # 實驗日誌 API（JSONL 檔案讀寫）
│   ├── experiment.js        # 實驗 API（ID 產生）
│   ├── logs.js              # 日誌 API
│   └── health.js            # 心跳檢測 API (`GET /api/health`)
├── middleware/
│   └── (目前為空，預留擴展)
├── utils/
│   ├── logger.js            # 日誌工具（console 包裝）
│   ├── idGenerator.js        # ID 產生工具
│   ├── checksum.js           # 校驗碼計算
│   └── time.js               # 時間工具
├── server/                           # 伺服器子專案依賴（node_modules, package.json）
└── test/
  └── ws-stress.js         # WebSocket 壓力測試

```

### runtime/ - 執行時資料（.gitignore 排除）

```

runtime/
├── database/
│ └── experiment.db # SQLite 資料庫檔案
│ ├── sessions 表 # 工作階段資料
│ ├── share*codes 表 # 分享代碼資料
│ ├── experiment_ids 表 # 實驗 ID 紀錄
│ └── state_updates 表 # 狀態更新日誌
├── experiment-data/
│ ├── {experimentId}*{timestamp}.jsonl # 實驗日誌（例：JHWH4A_1767975514075.jsonl）
│ └── ...
└── sessions/
└── (工作階段恢復資料)

```

### data/ - 靜態資料目錄

```

data/
├── scenarios.json # 場景設定（實驗情境數據）
├── units.json # 單元設定（包含組合定義和步驟）
├── section-a.json # 章節 A 設定
├── buttons.json # 按鈕設定（位置、標籤、動作）
├── gestures.json # 手勢識別設定
├── config.json # 前端業務設定（UI、功能開關、時區）
└── ref.txt # 參考資訊

```

### js/ - 前端 JavaScript 模組

#### js/core/ - 核心模組

| **config.js** | `ConfigManager` | 設定管理與版本管理。方法：loadConfigSettings, resetUserSettingsToDefaults, applySettings, saveUserSettings, loadVersionInfo |
| **console-manager.js** | `Logger` | 統一日誌記錄（多級別）。方法：debug, info, warn, error, setLogLevel, shouldLog, formatMessage |
| **data-loader.js** | 匯出函數 | 載入 scenarios/units 資料。函數：loadScenariosData(), loadUnitsFromScenarios(), buildActionSequenceFromUnits() |
| **websocket-client.js** | `WebSocketClient` | WebSocket 連線管理。方法：connect, disconnect, send, on, off, handleOpen, handleMessage, handleClose, handleError |
| **time-sync-manager.js** | `TimeSyncManager` | 時間同步與格式化。方法：initialize, syncWithServer, getServerTime, getTimeOffset, isSynchronized |
| **camera-utils.js** | `CameraUtils` | 相機裝置列舉、啟動、停止、重試。方法：enumerateDevices, start, stop, retry |
| **../constants/sync-events-constants.js** | 匯出常數 | 同步事件常數定義。常數：SYNC_EVENTS, SYNC_DATA_TYPES |
| **random-utils.js** | 匯出函數/物件 | 可重現隨機化工具。物件：RandomUtils。函數：createSeededRandom, shuffleArray, getCombinationUnitIds, generateExperimentId |

#### js/panel/ - 面板控制模組

| 檔案                                   | class                     | 主要功能                                                                                                                                                                                                               |
| -------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **panel-page-manager.js**     | `PanelPageManager`     | 面板頁面腳本載入協調。方法：initialize, loadCoreScripts, loadUIScripts, loadExperimentScripts, loadSyncScripts, loadScript, onInitializationComplete                                                                   |
| **panel-button-manager.js**   | `ButtonManager`        | 按鈕互動與邏輯。方法：loadButtonFunctions, clearButtonFunctions, simulateButtonClick, setupEventListeners, updateExperimentButtonStyles, handleButtonPressed                                                           |
| **panel-ui-manager.js**       | `PanelUIManager`       | UI 控制項與視覺設定。方法：updateScale, updateTopSpacer, updateBottomSpacer, updatePowerScale, updateButtonLabelVisibility, updateButtonColorVisibility, updateTouchVisuals, setupEventListeners, initializeUIControls |
| **panel-power-control.js**    | `PowerControl`         | 電源狀態管理。方法：updatePowerUI, setPowerState, updatePowerUIWithoutSync, updateMediaControlButtons, dispatchPowerStateChanged, setupEventListeners, disableAllButtons, enableAllButtons                             |
| **panel-media-manager.js**    | `MediaManager`         | 媒體預載入與快取。方法：setupEventListeners, playMedia, processMediaSrc, setupVideoElement, setupImageElement, playMediaInArea, preloadMedia, preloadCombinationMedia, stopHomePageLoop, playHomePageLoop              |
| **panel-logger.js**           | `PanelLogger`          | 操作日誌記錄。方法：initializeDOMElements, setupDOMElements, isExperimentMode, formatDateTime, getExperimentInfo, logAction, toggleLogger, showLogger, hideLogger, clearLog, exportLog                                 |
| **panel-experiment-power.js** | `PanelExperimentPower` | 電源管理與狀態監控。方法：handlePowerOn, handlePowerOff, highlightPowerSwitch, checkPowerState, setPowerState, handlePowerStateChange                                                                                  |
| **panel-sync-manager.js**     | `PanelSyncManager`     | 面板同步管理。方法：setupModuleReferences, setupSyncEventListeners, handleSyncExperimentStart, handleSyncExperimentPaused, handleSyncExperimentResumed, handleSyncExperimentStopped, handleSyncExperimentIdUpdate, handleSyncSubjectNameUpdate, handleSyncActionCompleted, handleSyncActionCancelled                                                                                          |

#### js/sync/ - 同步模組

| 檔案                                    | class                         | 主要功能                                                                                                                                                                                                                           |
| --------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **sync-manager.js**            | `SyncManager`              | 同步管理主入口。方法：initialize, setupInitialization。常數：ROLE, STATUS, ROLE_TEXTS, STATUS_TEXTS, PAGE, PAGE_LIST                                                                                                               |
| **sync-manager-core.js**       | `SyncManagerCore`          | 同步核心邏輯。方法：initDependencies, getBaseUrl, generateQRContent, createSession, joinSession, restoreSession, syncState, processOfflineQueue, syncCurrentStateToHub                                                             |
| **sync-manager-ui.js**         | `SyncManagerUI`            | UI 膠囊指示器與控制面板。方法：initialize, createCapsuleIndicator, createControlPanel, updateIndicator, updateUIState, showPanel, hidePanel, setupEventListeners, bindEvents                                                       |
| **sync-manager-sessions.js**   | `SyncManagerSessions`      | 工作階段管理 UI。方法：initialize, showSessionsPanel, loadSessionsData, renderSessionsList, bindEvents, refreshSessionsList, downloadSession, deleteSession                                                                        |
| **sync-manager-qr.js**         | `SyncManagerQR`            | QR Code 產生與掃描。方法：initialize, checkUrlParameters, generateQRCode, startQRScanner, stopQRScanner, refreshDeviceList, handleQRScanResult                                                                                     |
| **sync-confirm-dialog.js**     | `SyncConfirmDialogManager` | 加入工作階段確認對話。方法：showJoinConfirmation                                                                                                                                                                                   |
| **sync-client.js**             | `SyncClient`               | WebSocket + REST API 同步客戶端。方法：setupGlobalEventHandlers, initializeSync, setupWebSocketHandlers, createSession, joinSession, restoreSession, syncState, getShareCodeInfo, startHeartbeatCheck, loadState, saveState        |
| **experiment-sync-manager.js** | `ExperimentSyncCore`       | 實驗同步核心。方法：syncState, safeBroadcast, broadcastExperimentStart/Stop。由 BoardSyncManager 透過 ES module 使用 |
| **indicator-manager.js**       | `IndicatorManager`         | 同步狀態指示器管理。方法：initialize, updateIndicator, showIndicator, hideIndicator, setStatus, animateIndicator                                                                                                                   |

#### js/experiment/ - 實驗管理模組

**狀態**: 目錄包含現行實驗模組，並已整合至初始化流程（非空）。以下為目前存在的重要檔案與簡要說明：

```
js/experiment/
├── experiment-action-handler.js      # ExperimentActionHandler - 動作處理與事件路由，支援注入 FlowManager、HubManager
├── experiment-combination-manager.js # ExperimentCombinationManager - 組合載入、快取還原、隨機化與預設組合應用
├── experiment-flow-manager.js        # ExperimentFlowManager - 實驗流程協調（開始/暫停/停止/步進），接受 CombinationManager 注入
├── experiment-hub-manager.js         # ExperimentHubManager - 與實驗中樞/同步相關的延遲初始化與工作階段管理
├── experiment-state-manager.js       # ExperimentStateManager - 實驗狀態管理與持久化（從 js/core/ 遷移而來）
├── experiment-system-manager.js      # ExperimentSystemManager - 實驗系統統一管理器，協調各模組
├── experiment-timer.js               # ExperimentTimerManager - 統一計時器管理器
└── experiment-ui-manager.js          # ExperimentUIManager - 實驗 UI 元件、計時器、按鈕狀態與視覺提示管理
```

#### js/board/ - 實驗頁面專用模組

**狀態**: 新增目錄，專門為 `board.html` 頁面提供支援。

```
js/board/
├── board-page-manager.js         # BoardPageManager - 實驗頁面腳本載入與初始化協調
├── board-log-manager.js          # BoardLogManager - 實驗日誌管理
├── board-log-ui.js               # BoardLogUI - 日誌 UI 元件
├── board-sync-manager.js         # ExperimentSyncAdapter - 同步管理（匯入並協調 ExperimentSyncCore）
├── board-ui-manager.js           # BoardUIManager - UI管理（含 toggleLeftPanel, toggleGestureStats）
├── board-gesture-utils.js        # BoardGestureUtils - 手勢處理工具
└── experiment-simulator.js       # ExperimentSimulator - 實驗流程模擬工具（開發/測試用）
```

**新增：ExperimentSimulator （v2.5.0+）**

- **用途**: 模擬完整實驗流程，便於開發測試（不修改主代碼）
- **位置**: `js/board/experiment-simulator.js`
- **狀態**: ⚠️ 開發/測試用工具，生產環境可刪除
- **特點**:
  - 完全獨立，無修改主項目代碼
  - 透過公開 API 呼叫（boardPageManager 的公開方法）
  - 自動廣播所有操作 → Panel 端自動同步
  - 支援暫停/繼續操作
  - 詳細的控制台日誌

- **全域 API**:
  ```javascript
  window.simulateExperiment(options)      // 執行模擬
  window.getSimulatorStatus()             // 查詢狀態
  window.stopSimulator()                  // 停止模擬
  ```

- **刪除方式** (完全乾淨):
  1. 刪除 `js/board/experiment-simulator.js` 檔案
  2. 移除 `board.html` 中的引入代碼段（已清楚標記）
  3. 無其他依賴，安全移除

#### 檔案層級依賴與初始化順序

**重要**: 檔案載入順序由各頁面的 PageManager 協調：

**Panel 頁面載入順序** (`PanelPageManager`):

1. **Phase 1A - 核心模組** (`loadCoreScripts`, 並行載入)
   - `js/core/console-manager.js` (Logger)
   - `js/core/config.js` (ConfigManager)
   - `js/core/websocket-client.js` (WebSocketClient)
   - `js/core/time-sync-manager.js` (TimeSyncManager)
   - `js/core/random-utils.js` (RandomUtils)
   - `js/core/data-loader.js` (loadUnitsFromScenarios)
   - `js/sync/indicator-manager.js` (IndicatorManager)
   - `js/sync/sync-client.js` (SyncClient)

2. **Phase 1B - UI 模組** (`loadUIScripts`, 並行載入)
   - `js/panel/panel-ui-manager.js` (PanelUIManager)
   - `js/panel/panel-button-manager.js` (ButtonManager)
   - `js/panel/panel-logger.js` (PanelLogger)
   - `js/panel/panel-power-control.js` (PowerControl)

3. **Phase 1C - 實驗模組** (`loadExperimentScripts`, 並行載入)
   - `js/experiment/experiment-state-manager.js` (ExperimentStateManager)
   - `js/experiment/experiment-timer.js` (ExperimentTimerManager)
   - `js/experiment/experiment-system-manager.js` (ExperimentSystemManager)
   - `js/experiment/experiment-hub-manager.js` (ExperimentHubManager)
   - `js/experiment/experiment-combination-manager.js` (ExperimentCombinationManager)
   - `js/experiment/experiment-flow-manager.js` (ExperimentFlowManager)
   - `js/experiment/experiment-action-handler.js` (ExperimentActionHandler)
   - `js/experiment/experiment-ui-manager.js` (ExperimentUIManager)
   - `js/panel/panel-media-manager.js` (MediaManager)
   - `js/panel/panel-experiment-power.js` (PanelExperimentPower)

4. **Phase 1D - 同步模組** (`loadSyncScripts`, 並行載入)
   - `js/sync/sync-confirm-dialog.js` (SyncConfirmDialogManager)
   - `js/sync/sync-manager.js` (SyncManager, ES module)
   - `js/panel/panel-sync-manager.js` (PanelSyncManager)

**Board 頁面載入順序** (`BoardPageManager`):

**注意**: 所有 25 個腳本在單一批次中**全部並行載入**（`Promise.all`），以下為邏輯分類：

- **核心基礎設施**: `console-manager.js`, `config.js`, `websocket-client.js`, `time-sync-manager.js`
- **實驗狀態**: `experiment-state-manager.js`
- **同步系統**: `sync-client.js`, `experiment-hub-manager.js`
- **核心工具**: `data-loader.js`, `random-utils.js`
- **實驗模組**: `experiment-combination-manager.js`, `experiment-flow-manager.js`, `experiment-action-handler.js`, `experiment-ui-manager.js`, `experiment-system-manager.js`, `experiment-timer.js`
- **Board 專用**: `board-log-manager.js`, `board-log-ui.js`, `board-sync-manager.js`, `board-ui-manager.js`, `board-gesture-utils.js`
- **同步與對話框**: `experiment-sync-manager.js`, `sync-confirm-dialog.js`, `js/constants/sync-events-constants.js` (ES module), `sync-manager.js` (ES module)

`sync-manager.js` 作為 ES module 會透過 import 自動載入子模組：`sync-manager-core.js`, `sync-manager-ui.js`, `sync-manager-qr.js`, `sync-manager-sessions.js`

注意事項：

- 各頁面的 PageManager 會協調檔案載入順序
- `initializeModules()` 現在會在沒有現有實驗 ID 時自動產生一個實驗 ID，並在可用時通知 `ExperimentCombinationManager` 以重新套用預設組合（以確保一致的實驗狀態）
- `setupModuleDependencies()` 已加入明確的注入步驟（例如將 `ExperimentCombinationManager` 注入 `ExperimentFlowManager`，以及將 `ExperimentFlowManager` 注入 `ExperimentActionHandler`），以避免初始化順序導致的未注入狀態

**初始化依賴關係**:

```

PanelPageManager.initialize()
├─ loadCoreScripts() // 載入 js/core 所有模組
├─ loadUIScripts() // 載入 js/panel 所有模組
├─ loadExperimentScripts() // 載入 js/experiment 所有模組
├─ loadSyncScripts() // 載入 js/sync 所有模組
│ └─ SyncManager.initialize()
│ └─ SyncManagerCore, SyncManagerUI, 等
└─ onInitializationComplete()

```

---

### css/ - 樣式表目錄

```

css/
├── style.css # 主樣式表入口
├── base/
│ ├── global.css # 全域樣式
│ ├── layout.css # 佈局樣式
│ └── scrollbar.css # 捲軸樣式
├── components/
│ ├── button-styles.css # 按鈕樣式
│ ├── buttons.css # 按鈕變體
│ ├── control-panel.css # 控制面板樣式
│ ├── forms.css # 表單樣式
│ ├── general-buttons.css # 一般按鈕
│ ├── media-area.css # 媒體區域樣式
│ ├── power-button.css # 電源按鈕樣式
│ ├── svg-panel.css # SVG 面板樣式
│ ├── toggle-switch.css # 切換開關樣式
│ └── ui-buttons.css # UI 按鈕樣式
├── features/
│ ├── experiment/
│ │ ├── buttons.css
│ │ ├── cards.css
│ │ ├── combinations.css
│ │ ├── controls.css
│ │ ├── gestures.css
│ │ ├── layout.css
│ │ ├── log-view-modal.css
│ │ ├── logs.css
│ │ ├── stats.css
│ │ └── units.css
│ └── panels/
│   ├── experiment-panel.css
│   ├── log-panel.css
│   └── maintenance-panel.css
├── pages/
│ ├── board-page.css # Board 頁面專用樣式
│ └── panel-page.css # Panel 頁面專用樣式
├── states/
│ ├── experiment-states.css
│ ├── interaction-states.css
│ └── power-states.css
├── sync/
│ ├── confirm.css
│ ├── indicator.css
│ ├── modal.css
│ ├── qr.css
│ └── sessions.css
└── utilities/
├── animations.css
├── responsive-board.css # Board 頁面響應式設計
└── responsive.css

```

### assets/ - 資源檔案

```

assets/
├── audio/ # 音聲檔案
├── ui/
│ ├── buttons/ # 按鈕圖標
│ └── power/ # 電源相關圖標
└── units/
├── A001-夾開力矩設定(30)/ # 各單元資源
├── A002-推桿後退定點設定(400)/
├── A003-送出過短設定(25)/
├── A004-更改語言為英語/
└── SYSTEM/ # 系統媒體（首頁影片等）

```

### 根目錄檔案

```

panel/
├── index.html # 機台面板（受試者端，實驗操作）
├── board.html # 實驗管理（研究者端，實驗分析）
├── README.md # 專案說明
├── package.json # Node.js 依賴管理
├── package-lock.json # 依賴鎖定檔案
├── eslint.config.cjs # ESLint 設定
├── panel.code-workspace # VS Code 工作區設定
└── favicon.ico # 網站圖標

scripts/
├── find_duplicate_logs.js # 重複日誌檢測工具
└── update-version.js # 版本更新腳本

```

### docs/ - 文件目錄

```

docs/
├── ARCHITECTURE.md # 架構文件（本文件）
├── PROJECT_TERMINOLOGY_GUIDE.md # 專案術語指南
└── scenarios_structure.md # Scenarios 架構說明

```

---

## 版本管理系統

專案使用 git commit hash 作為版本識別碼，提供更好的版本追蹤。

### 自動化版本更新

```bash
# 更新所有版本資訊（推薦）
npm run version:update

# 僅更新 git commit hash
npm run version:hash

# 查看目前版本狀態
npm run version:status
```

### Git Commit Hash 說明

- **完整 hash**: 40 位字符 (如: `09f31f10f01bbc67831146436a49f6de71c02b46`)
- **短 hash**: 預設 7 位 (如: `09f31f1`)
- **專案使用**: 7 位短 hash (如: `09f31f1`)

版本號格式: `major.minor.git-hash` (如: `1.5.09f31`)

---

## 更新說明與已知問題

### 日誌管理

**關鍵原則**：所有控制台輸出都應使用 `Logger` 統一管理，避免直接呼叫 `console.log/error/warn`

#### 日誌層級使用規範

| 層級  | 用途             | 範例                             |
| ----- | ---------------- | -------------------------------- |
| INFO  | 關鍵初始化進度   | `初始化完成`、`連線成功`         |
| DEBUG | 詳細的過程性訊息 | `載入腳本: xxx.js`、`腳本已快取` |
| WARN  | 警告性訊息       | `等待 SyncManager 超時`          |
| ERROR | 錯誤與異常       | `初始化失敗`、`連線失敗`         |

**規則**：

- 過於詳細的日誌（每個腳本的載入、快取檢查）→ **DEBUG**
- 重要事件和里程碑 → **INFO**
- 異常情況和潛在問題 → **WARN**
- 失敗和錯誤 → **ERROR**

#### 避免多重前綴

**問題**：

```
[PanelPageManager] 開始初始化 (耗時: 69ms)  ← 自訂前綴
panel-page-manager.js:190                  ← 瀏覽器自動加的 sourceMap
```

**解決**：改用 Logger，由它負責統一格式化

```
[INFO] [panel-page-manager.js:190] 開始初始化 (耗時: 69ms)
```

## 核心概念與變數定義

### 1. 工作階段 (Session)

Session 是多裝置同步的基本單元，聚合多個 clients。

```javascript
interface Session {
  sessionId: string; // 6位大寫英數字
  createdAt: number; // Unix 時間戳
  updatedAt: number;
  lastActiveAt: number;
  isActive: boolean;

  createdBy: string | null;
  createCode: string;

  clients: Client[];
  maxClients: number; // 預設 6

  state: {
    experimentId?: string,
    experimentRunning?: boolean,
    customData?: any,
  };
}
```

### 2. 分享代碼 (ShareCode)

用於客戶端加入工作階段的代碼，格式：5 位基礎碼 + 1 位校驗碼。

```javascript
interface ShareCode {
  code: string; // 6位代碼 (123456)
  sessionId: string;

  createdAt: number;
  expiresAt: number;

  used: boolean;
  usedAt: number | null;
  usedBy: string | null;

  expired: boolean;
  checksumValid: boolean;
}
```

校驗碼計算（Luhn 演算法變體）：

```javascript
function calculateChecksum(baseCode) {
  // baseCode 為 5 位數字
  let sum = 0;
  for (let i = 0; i < baseCode.length; i++) {
    let digit = parseInt(baseCode[i]);

    // 從右到左，偶數位置數字乘以 2
    if ((baseCode.length - i) % 2 === 0) {
      digit *= 2;
      if (digit > 9) {
        digit = Math.floor(digit / 10) + (digit % 10);
      }
    }
    sum += digit;
  }

  // 計算校驗碼
  const checksum = (10 - (sum % 10)) % 10;
  return checksum.toString();
}
```

### 3. 客戶端 (Client)

Client 是分頁級實體，每個瀏覽器分頁擁有獨立的 clientId。

```javascript
interface Client {
  clientId: string; // D{timestamp}{random} (分頁唯一)
                    // 範例: "D1736405234567ABC"
  role: "viewer" | "operator";

  connectedAt: number;
  lastHeartbeat: number;
  connectionState: "connected" | "disconnected" | "reconnecting";

  wsConnectionId: string; // WebSocket 內部 ID
}
```

**clientId 產生機制**：

```javascript
function generateClientId() {
  const timestamp = Date.now(); // 13位時間戳
  const random = Math.random().toString(36).substring(2, 5).toUpperCase(); // 3位隨機碼
  return `D${timestamp}${random}`;
}
```

### 4. 實驗 ID

```javascript
interface ExperimentId {
  experimentId: string; // 6位隨機碼，例如: "JHWH4A", "K3LM9P"
  sessionId: string | null;
  createdAt: number;
  source: string; // "panel", "state_manager"
}
```

**格式**：`[A-Z0-9]{6}` - 6 位大寫英數字隨機碼

**特性**：相同 ID 搭配相同組合邏輯，可透過 seeded random 還原實驗序列排序

**產生機制** (統一格式):

```javascript
function generateExperimentId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
```

**格式說明**:

- 長度: 6位字符
- 字符集: 大寫英文字母(A-Z) + 數字(0-9)
- 範例: "JHWH4A", "K3LM9P", "A1B2C3"

**同工作階段多客戶端同步示範**:

```javascript
// Tab 1 重新整理，獲得新 clientId
Tab1: {
  clientId: 'D1JKFL2P-A3B5C7',
  sessionId: 'SESSION1',
  wsConnectionId: 'ws_conn_001'
}

// Tab 2 也加入同一工作階段，但 clientId 不同
Tab2: {
  clientId: 'D1JKFL2P-X9Y8Z7',  // 不同 clientId
  sessionId: 'SESSION1',          // 同工作階段
  wsConnectionId: 'ws_conn_002'   // 不同連線
}

// 後端 Session 中記錄兩個 clients
Session['SESSION1'].clients = [
  { clientId: 'D1JKFL2P-A3B5C7', ... },
  { clientId: 'D1JKFL2P-X9Y8Z7', ... }
]

// 結果：Tab 1 的狀態更新 → 廣播到同 session 內所有 clients → Tab 2 收到（自動同步）
```

---

### 5. **狀態更新 (State Update)**

**定義**: 即時同步的狀態變化事件

**WebSocket 訊息格式**:

```javascript
interface WSMessage {
  type: string; // 訊息類型
  timestamp: number; // 時間戳 (毫秒)
  sessionId: string; // 工作階段ID
  clientId: string; // 發送者 clientId
  data: any; // 具體資料
}

// 訊息類型定義
const WS_MESSAGE_TYPES = {
  // 連線管理
  CONNECT: "connect",
  DISCONNECT: "disconnect",
  HEARTBEAT: "heartbeat",

  // 工作階段管理
  SESSION_CREATED: "session_created",
  SESSION_JOINED: "session_joined",
  SESSION_LEFT: "session_left",
  SESSION_STATE_UPDATE: "session_state_update",

  // 實驗同步
  EXPERIMENT_STARTED: "experiment_started",
  EXPERIMENT_PAUSED: "experiment_paused",
  EXPERIMENT_RESUMED: "experiment_resumed",
  EXPERIMENT_STOPPED: "experiment_stopped",
  EXPERIMENT_ID_UPDATE: "experiment_id_update",

  // 校時
  SERVER_TIME: "server_time", // 伺服器時間戳（認證時傳遞）

  // 錯誤處理
  ERROR: "error",
  VALIDATION_ERROR: "validation_error",
};
```

---

## 資料流說明

### 本機模式（無同步）

```
使用者操作 → PanelManager
          ↓
    ExperimentStateManager
          ↓
    localStorage (資料持久性)
          ↓
    ExperimentLogManager
          ↓
    IndexedDB (日誌儲存)
          ↓
    本機下載 (JSONL 格式)
```

### 同步模式（多裝置）

```
裝置A 使用者操作 → PanelManager
                ↓
          ExperimentStateManager
                ↓
          localStorage + WebSocket
                ↓
          sync-client.js
                ↓
          websocket-client.js
                ↓
          WebSocket 伺服器
                ↓
          廣播給其他裝置
                ↓
裝置B/C/D ← WebSocket 接收
          ↓
    sync-client.js 處理
          ↓
    ExperimentStateManager 更新
          ↓
    UI 即時更新
```

### 校時機制（WebSocket 一次性）

```
前端連線 → WebSocket 握手
          ↓
     authenticate (clientId, sessionId)
          ↓
伺服器回應 → auth_success + serverTime
          ↓
    websocket-client.js 接收
          ↓
    timeSyncManager.syncWithWebSocket(serverTime)
          ↓
    計算時間偏差並儲存
          ↓
    後續所有時間戳使用校正後的時間
```

---

## 運作模式與實驗中樞註冊 (Operating Modes)

### 設計原則

系統支援兩種獨立的運作模式，根據是否存在工作階段自動切換：

#### 1. 獨立運作模式（本機模式）

- **條件**: 未建立或加入工作階段（無 sessionId）
- **特性**:
  - 實驗中樞不初始化（hubClient = null）
  - 不需要 WebSocket 連線
  - 不進行實驗 ID 註冊
  - 狀態僅存本機 sessionStorage / localStorage
  - 適合單人操作、測試開發
  - 支援頁面重新整理還原狀態

#### 2. 同步運作模式（協作模式）

- **條件**: 已建立或加入工作階段（有 sessionId + clientId）
- **特性**:
  - ExperimentHubClient 初始化（延遲初始化）
  - WebSocket 連線到伺服器
  - 實驗 ID 自動註冊到中樞
  - 狀態實時同步到所有連線裝置
  - 支援多裝置協作、多分頁操作
  - 斷線自動重連，離線狀態暫存

### 模式檢測機制

```javascript
// ExperimentHubManager.isInSyncMode()
import { SyncClient } from './sync-client.js';
const syncClient = SyncClient.getInstance(); // 取得 SyncClient 實例
const sessionId = syncClient?.getSessionId?.();
const clientId = syncClient?.clientId;
const hasSession = sessionId && clientId;
return hasSession; // true = 同步模式，false = 獨立模式
```

### 實驗中樞註冊邏輯

**修正**: 所有實驗 ID 產生與註冊都需要檢查模式

```javascript
// 產生新實驗 ID
import { experimentHubManager } from './experiment-hub-manager.js';

if (experimentHubManager?.isInSyncMode?.()) {
  // 同步模式：註冊到中樞
  experimentHubManager.registerExperimentId(newId, "source");
} else {
  // 獨立模式：僅存本機
  Logger.debug(`[獨立模式] 實驗ID僅存本機: ${newId}`);
}
```

**涵蓋位置**:

1. ExperimentStateManager.generateExperimentId()
2. PanelExperimentManager.startExperiment()
3. PanelExperimentManager.autoGenerateExperimentId()
4. ExperimentPageManager.generateExperimentIdWithHub()
5. ExperimentPageManager.registerExperimentIdToHub()

---

## 重新連線與離線機制 (Reconnect & Offline System)

### 設計目標

支援分頁重新整理後自動還原連線，保持客戶端身份和工作階段狀態，適用於：

- 同一台電腦開啟多個分頁（機台面板、實驗管理）
- 分頁意外關閉或網路中斷後重新載入
- 避免重新整理後丟失進度或角色資訊
- 網路不穩定時快取待發送的狀態更新

### 前端實作策略

#### 1. 儲存機制（多層級）

```javascript
// localStorage: 同步模式資訊（跨分頁、跨工作階段）
localStorage.setItem("sync_session_id", sessionId); // 用於還原

// sessionStorage: 分頁級狀態（分頁重新整理用）
sessionStorage.setItem("sync_sessionId", sessionId); // 本分頁用
sessionStorage.setItem("sync_clientId", clientId); // 本分頁用
sessionStorage.setItem("sync_role", role); // 本分頁用

// 實驗狀態快照（pageManager 用）
sessionStorage.setItem("experiment_state_snapshot", JSON.stringify(snapshot));
```

#### 2. 多層級儲存策略

| 儲存方式           | 用途             | 重新整理 | 多分頁 | 關閉瀏覽器 |
| ------------------ | ---------------- | -------- | ------ | ---------- |
| **sessionStorage** | 分頁級重連(推薦) | 保留     | 隔離   | 消失       |
| **localStorage**   | 跨工作階段還原   | 保留     | 共用   | 保留       |
| **IndexedDB**      | 實驗日誌快取     | 保留     | 共用   | 保留       |
| **memory**         | 離線佇列暫存     | 消失     | 隔離   | 消失       |

**選擇三層的理由**:

- sessionStorage: 分頁重新整理後快速還原（個別分頁不相互干擾）
- localStorage: 意外關閉工作階段後，下次存取可快速還原連線
- IndexedDB: 實驗日誌本機化，支援離線編輯、同步後上傳
- memory: 即時離線佇列，重連後立即發送

#### 3. 離線佇列機制

```javascript
// SyncManagerCore.offlineQueue
this.offlineQueue = [];  // 未連線時暫存狀態更新

// 離線時加入佇列
addToOfflineQueue(state) {
  // 去重：只保留最新的相同型態狀態
  if (lastSimilar && lastSimilar.state.timestamp < state.timestamp) {
    replace(lastSimilar);  // 用新狀態覆蓋舊狀態
  } else {
    push(state);  // 新增到佇列
  }
}

// 連線恢復時處理佇列
async processOfflineQueue() {
  const sortedItems = offlineQueue.sort(by timestamp);
  for (const item of sortedItems) {
    const result = await syncClient.syncState(item.state);
    if (result) {
      remove(item);  // 成功才移除
    } else {
      break;  // 停止，等待下次重試
    }
  }
}
```

#### 4. WebSocket 重新連線流程

```javascript
// 前端 WebSocket 客戶端
class WebSocketClient {
  constructor() {
    this.ws = null;
    this.clientId = null;
    this.sessionId = null;
    this.role = null;
  }

  // 初始化連線
  async connect() {
    // 1. 檢查是否有儲存的連線資訊
    const savedClientId = sessionStorage.getItem("panel_clientId");
    const savedSessionId = sessionStorage.getItem("panel_sessionId");
    const savedRole = sessionStorage.getItem("panel_role");

    // 2. 建立 WebSocket 連線
    this.ws = new WebSocket("ws://localhost:7645/ws");

    // 3. 連線成功後認證
    this.ws.onopen = () => {
      if (savedClientId && savedSessionId) {
        // 重新連線：使用儲存的 clientId
        this.authenticate(savedSessionId, savedClientId, savedRole);
      } else {
        // 首次連線：需要先建立或加入工作階段
        // (通常由 SyncManager 處理)
      }
    };

    // 4. 處理伺服器回應（含校時）
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === "auth_success") {
        const {
          clientId,
          sessionId,
          role,
          isReconnect,
          serverTime, // 伺服器時間戳（毫秒）
        } = message.data;

        // 一次性校時
        import { TimeSyncManager } from './time-sync-manager.js';
        if (serverTime && TimeSyncManager.getInstance()) {
          TimeSyncManager.getInstance().syncWithWebSocket(serverTime);
        }

        // 儲存到 sessionStorage
        sessionStorage.setItem("panel_clientId", clientId);
        sessionStorage.setItem("panel_sessionId", sessionId);
        sessionStorage.setItem("panel_role", role);

        if (isReconnect) {
          console.log("重新連線成功，已還原狀態");
        } else {
          console.log("首次連線成功");
        }
      }
    };
  }

  // 發送認證訊息
  authenticate(sessionId, clientId, role = "viewer") {
    this.ws.send(
      JSON.stringify({
        type: "auth",
        data: { sessionId, clientId, role },
      }),
    );
  }
}
```

### 後端處理邏輯

#### 1. ConnectionManager 重新連線處理

```javascript
authenticate(wsConnectionId, clientId, sessionId) {
  // 檢查 clientId 是否已存在（重新連線）
  const existingWsConnectionId = this.clientIdMap.get(clientId);
  const isReconnect = existingWsConnectionId !== undefined;

  if (isReconnect) {
    // 關閉舊連線
    const oldConnection = this.connections.get(existingWsConnectionId);
    if (oldConnection && oldConnection.ws.readyState === 1) {
      oldConnection.ws.close(1000, 'Client reconnected');
    }

    // 移除舊連線記錄
    this.connections.delete(existingWsConnectionId);
  }

  // 註冊新連線並回傳 isReconnect 標記
  // ...
  return isReconnect;
}
```

#### 2. MessageHandler 認證處理

```javascript
async handleAuth(wsConnectionId, data, ws) {
  const { sessionId, clientId, role } = data;

  // 認證連線（自動處理重新連線）
  const isReconnect = this.connectionManager.authenticate(
    wsConnectionId, clientId, sessionId
  );

  // 加入房間
  const roomInfo = this.roomManager.join(sessionId, clientId, {
    role,
    isReconnect
  });

  // 發送認證成功回應（包含 isReconnect 標記）
  this.sendResponse(ws, 'auth_success', {
    sessionId,
    clientId,
    role,
    roomInfo,
    isReconnect  // 告知前端是否為重新連線
  });

  // 只在首次加入時廣播 client_joined
  // 重新連線時廣播 client_reconnected（避免重複通知）
  if (!isReconnect) {
    this.broadcastManager.broadcastClientJoined(sessionId, clientId, { role });
  } else {
    this.broadcastManager.broadcastToRoom(sessionId, {
      type: 'client_reconnected',
      data: { clientId, role }
    }, { excludeClientId: clientId });
  }

  // 發送目前工作階段狀態
  const currentState = this.getSessionState(sessionId);
  this.broadcastManager.sendToClient(clientId, {
    type: 'session_state',
    data: currentState
  });
}
```

### 使用場景示範

#### 場景 1: 獨立模式 - 單人測試

```
1. 打開機台面板 (index.html)
   → 無工作階段
   → isSyncMode = false
   → 實驗中樞 (hubClient) = null
   → 只產生本機實驗 ID
   → 狀態存 sessionStorage/localStorage

2. 頁面重新整理
   → 從 sessionStorage 還原狀態快照
   → UI 自動恢復為重新整理前的狀態
   → 不涉及 WebSocket

3. 關閉瀏覽器再開啟
   → localStorage 中的實驗 ID 被讀取
   → 使用者可繼續編輯已有的實驗
```

#### 場景 2: 機台面板重新整理（同步模式）

```
1. 使用者開啟機台面板 (index.html)
   → 建立 Session: SESSION1
   → 產生 clientId: CLIENT1
   → 儲存至 sessionStorage
   → 角色: operator

2. 使用者不小心按了 F5 重新整理
   → 從 sessionStorage 讀取 CLIENT1, SESSION1
   → WebSocket 重新連線
   → 後端識別為重新連線，不發送 client_joined
   → 前端還原之前的操作狀態

3. 結果: 使用者感覺不到中斷，繼續操作
```

#### 場景 3: 同時開啟機台面板和實驗管理（同步模式）

```
分頁 A (機台面板):
  - clientId: CLIENT_A
  - sessionId: SESSION1
  - role: operator
  - sessionStorage: {sync_clientId: CLIENT_A, sync_sessionId: SESSION1, sync_role: operator}
  - localStorage: {sync_session_id: SESSION1}  (多分頁共用)

分頁 B (實驗管理):
  - clientId: CLIENT_B
  - sessionId: SESSION1  (同一工作階段)
  - role: viewer
  - sessionStorage: {sync_clientId: CLIENT_B, sync_sessionId: SESSION1, sync_role: viewer}
  - localStorage: {sync_session_id: SESSION1}  (同上)

分頁 A 重新整理：
  → 從 sessionStorage 讀取 CLIENT_A（保持操作者身份）
  → 從 localStorage 確認工作階段有效
  → WebSocket 重新連線
  → 伺服器識別為 CLIENT_A，恢復房間  後端
 │                               │
 ├─ (1) connect ──────────────>│
 │                               ├─ 註冊 wsConnectionId
 │<─────────── (2) connected ─┤
 │                               │
 ├─ (3) auth (clientId...) ──>│
 │                               ├─ 檢查 clientId 是否已存在
 │                               ├─ 若存在 → 關閉舊連線
 │                               ├─ isReconnect = true/false
 │                               ├─ 加入房間
 │<─── (4) auth_success ─────┤
 │  (isReconnect + serverTime)   │
 │                               │
 ├─ (5) timeSyncManager 校時
 │                               │
 ├─ (6) 根據 isReconnect 還原──│
 │  (若 true 則從狀態快照還原)   │
 │                               │
 │<──── (7) session_state ────┤  (目前工作階段狀態)
 │                               │
 │<── (8) client_reconnected ─┤  (通知其他客戶端)
 │                               │
 (若有離線佇列)
 │<── (9) [待發送狀態1] ───────│
 │<── [待發送狀態2]            │
 │<── [待發送狀態3]            │
 │                               │
 ├─ (10) processOfflineQueue()
 │  ├─ 按時間戳排序所有待發送
 │  ├─ 逐個呼叫 syncState()
 │  └─ 成功後移除佇列
 │   syncState() 呼叫失敗
├─ 狀態加入離線佇列
├─ 20秒後重試連線
├─ 指示器顯示 離線

網路恢復
├─ WebSocket 重新連線成功
├─ processOfflineQueue() 處理佇列
├─ 按時間戳發送所有待發送狀態
├─ 佇列清空
├─ 指示器顯示 已連線
```

### WebSocket 事件流程圖（完整版）

```
前端                          後端
 │                             │
 ├─ connect ──────────────────>│
 │                             ├─ 註冊 wsConnectionId
 │<─────────────── connected ──┤
 │                             │
 ├─ auth (含 clientId) ───────>│
 │                             ├─ 檢查 clientId 是否已存在
 │                             ├─ 若存在 → 關閉舊連線
 │                             ├─ isReconnect = true
 │                             ├─ 加入房間
 │<─── auth_success (含 isReconnect) ─┤
 │                             │
 ├─ 根據 isReconnect 還原 UI ──│
 │<──── session_state ─────────┤  (目前狀態)
 │                             │
 │<──── client_reconnected ────┤  (通知其他客戶端)
 │                             │
```

---

## API 端點

### HTTP REST API

#### 1. 健康檢查

- **端點**: `GET /api/health`
- **回應**: `{ success: true, message: "Server online", timestamp: 1234567890 }`

#### 2. 同步 API

| 方法   | 端點                                      | 說明                         |
| ------ | ----------------------------------------- | ---------------------------- |
| POST   | `/api/sync/session`                       | 建立新的工作階段             |
| POST   | `/api/sync/create_session`                | 建立工作階段（僅建立）       |
| POST   | `/api/sync/generate_share_code`           | 產生分享代碼                 |
| POST   | `/api/sync/join`                          | 使用分享代碼加入工作階段     |
| POST   | `/api/sync/session/:sessionId/share-code` | 為指定工作階段產生分享代碼   |
| GET    | `/api/sync/session/:sessionId/validate`   | 驗證工作階段是否有效         |
| GET    | `/api/sync/session/:sessionId/clients`    | 取得工作階段中的所有客戶端   |
| GET    | `/api/sync/session/:sessionId`            | 取得工作階段資訊             |
| GET    | `/api/sync/sessions`                      | 取得所有活動中的工作階段列表 |
| DELETE | `/api/sync/session/:sessionId`            | 刪除指定的工作階段           |
| POST   | `/api/sync/sessions/clear`                | 清除所有工作階段             |
| POST   | `/api/sync/heartbeat`                     | 更新工作階段活動時間         |
| GET    | `/api/sync/share-code/:code`              | 取得分享代碼資訊             |

#### 3. 實驗 API

| 方法 | 端點                 | 說明        |
| ---- | -------------------- | ----------- |
| POST | `/api/experiment/id` | 建立實驗 ID |

#### 4. 日誌 API

| 方法   | 端點                             | 說明             |
| ------ | -------------------------------- | ---------------- |
| GET    | `/api/experiment-logs/list`      | 列出所有日誌檔案 |
| POST   | `/api/experiment-logs/save`      | 儲存日誌檔案     |
| GET    | `/api/experiment-logs/:filename` | 讀取日誌檔案內容 |
| DELETE | `/api/experiment-logs/:filename` | 刪除日誌檔案     |

---

### WebSocket 事件

完整訊息類型定義請參閱下方 **[WebSocket 訊息類型與同步事件參考](#websocket-訊息類型與同步事件參考)** 章節。

---

## WebSocket 訊息類型與同步事件參考

### 1. WS_PROTOCOL — WebSocket 傳輸層訊息類型

定義檔：`shared/ws-protocol-constants.js`

#### C2S（客戶端 → 伺服器）

| `type` 值                | 說明                                       | 伺服器處理器                 |
| ------------------------ | ------------------------------------------ | ---------------------------- |
| `auth`                   | 認證連線，建立工作階段綁定                 | `handleAuth`                 |
| `heartbeat`              | 心跳，維持連線活躍                         | `handleHeartbeat`            |
| `state_update`           | 狀態廣播（承載所有業務事件的主通道）       | `handleStateUpdate`          |
| `get_session_state`      | 取得目前工作階段完整狀態快照               | `handleGetSessionState`      |
| `ping`                   | Ping                                       | `handlePing`                 |
| `experiment_id_register` | 任一端重新產生實驗 ID 後廣播給同頻道所有人 | `handleExperimentIdRegister` |

#### S2C（伺服器 → 客戶端）

| `type` 值               | 說明                         | 主要 payload 欄位                     |
| ----------------------- | ---------------------------- | ------------------------------------- |
| `connected`             | 連線成功                     | `wsConnectionId`, `serverTime`        |
| `auth_success`          | 認證成功                     | `sessionId`, `clientId`, `role`       |
| `clear_sync_data`       | 要求客戶端清除本機同步狀態   | —                                     |
| `heartbeat_ack`         | 心跳確認                     | `timestamp`                           |
| `pong`                  | Ping 回應                    | `timestamp`                           |
| `session_state`         | 完整工作階段狀態快照         | `sessionId`, `state`, `clients`       |
| `session_state_update`  | 工作階段狀態增量更新         | `sessionId`, `state`                  |
| `state_update_ack`      | 狀態更新確認                 | `timestamp`                           |
| `client_joined`         | 有客戶端加入工作階段         | `clientId`, `role`                    |
| `client_left`           | 有客戶端離開工作階段         | `clientId`                            |
| `client_reconnected`    | 客戶端重新連線               | `clientId`                            |
| `experiment_started`    | 實驗開始                     | `experimentId`, `source`, `timestamp` |
| `experiment_paused`     | 實驗暫停                     | `experimentId`, `source`              |
| `experiment_resumed`    | 實驗繼續                     | `experimentId`, `source`              |
| `experiment_stopped`    | 實驗停止                     | `experimentId`, `source`              |
| `experiment_id_changed` | 實驗 ID 已變更（伺服器推播） | `experimentId`, `timestamp`           |
| `error`                 | 錯誤訊息                     | `code`, `message`                     |

---

### 1.5. 廣播事件 Schema 層級化統一標準

#### 層 1：傳輸層 - 固定格式

所有客户端發出的業務廣播均遵循統一的傳輸層 schema：

```javascript
{
  type: string,              // 必須：SYNC_DATA_TYPES 常數值
  clientId: string,          // 必須：發送者識別碼
  timestamp: number,         // 必須：毫秒級時間戳 (Date.now())
  ...businessFields          // 業務特定欄位
}
```

**欄位約束：**
- `type`：直接使用 SYNC_DATA_TYPES 中的值，不混合結構（例如不使用 `type: "state_change" + event: "paused"` 的矛盾設計）
- `clientId`：由發送方決定（透過 SyncClient 實例的 clientId 屬性取得，如 `syncClient.clientId` 或 `syncManager.clientId`）
- `timestamp`：統一為毫秒級整數（Date.now()），便於邏輯比較和去重
- 欄位順序：type → clientId → timestamp → 業務欄位

#### 層 2：業務層 - 各事件定義

根據 type 值，各廣播方法定義特定的業務欄位。詳見下節 「SYNC_DATA_TYPES」表格。

#### 修改記錄（2026-03-28）

- ✅ 統一所有廣播 timestamp 為 Date.now() 毫秒格式
- ✅ 統一 Pause/Resume/Stop 為 type 直接值（移除 type + event 混合結構）
- ✅ 所有廣播添加 clientId 和調整欄位順序
- ✅ 移除冗餘的 experimentSyncCore.broadcastButtonAction()
- ✅ 涵蓋檔案：experiment-sync-manager.js、panel-button-manager.js、experiment-action-handler.js、panel-experiment-power.js、board-gesture-utils.js、experiment-combination-manager.js、panel-sync-manager.js、board-page-manager.js、board-sync-manager.js、panel-power-control.js、experiment-ui-manager.js、experiment-hub-manager.js、experiment-system-manager.js

---

### 2. SYNC_DATA_TYPES — `state_update` 內部 `type` 欄位

所有透過 `state_update` C2S 訊息傳送的業務廣播，其 payload 中的 `type` 欄位對應如下，均遵循層 1 固定格式。
定義檔：`js/constants/sync-events-constants.js`（`SYNC_DATA_TYPES`）

#### 實驗生命週期

| `type` 值              | 常數                    | 發送端              | 主要 payload 欄位                     |
| ---------------------- | ----------------------- | ------------------- | ------------------------------------- |
| `experiment_initialize` | `EXPERIMENT_INITIALIZE` | board（實驗管理頁） | `experimentId`, `units`               |
| `experiment_started`   | `EXPERIMENT_STARTED`    | board               | `experimentId`, `source`, `timestamp` |
| `experiment_paused`    | `EXPERIMENT_PAUSED`     | board               | `experimentId`, `source`              |
| `experiment_resumed`   | `EXPERIMENT_RESUMED`    | board               | `experimentId`, `source`              |
| `experiment_stopped`   | `EXPERIMENT_STOPPED`    | board               | `experimentId`, `source`              |

#### 實驗資訊更新

| `type` 值               | 常數                      | 發送端                   | 主要 payload 欄位                        |
| ----------------------- | ------------------------- | ------------------------ | ---------------------------------------- |
| `experiment_id_update`    | `EXPERIMENT_ID_UPDATE`    | board / 面板（備援路徑） | `experimentId`, `client_id`, `timestamp` |
| `subject_name_update` | `SUBJECT_NAME_UPDATE` | board                    | `subjectName`, `timestamp`           |
| `combination_selected`  | `COMBINATION_SELECTED`    | board / 面板             | `combination`, `timestamp`               |

#### 動作與手勢（board 頁）

| `type` 值                | 常數                     | 主要 payload 欄位                                                          |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------- |
| `action_completed`       | `ACTION_COMPLETED`       | `action_id`, `step_id`, `unit_id`, `client_id`, `duration_ms`, `experiment_id`, `combination_id`, `subject_name`, `timestamp` |
| `action_cancelled`       | `ACTION_CANCELLED`       | `action_id`, `gesture_index`, `client_id`, `timestamp`                     |
| `gesture_marked`         | `GESTURE_MARKED`         | `step_index`, `gesture_name`, `mark_status`, `timer_value`, `timestamp`    |
| `gesture_step_completed` | `GESTURE_STEP_COMPLETED` | `step_index`, `gesture_name`, `timer_value`, `timestamp`                   |

**補充（action 同步方向）**
- action 狀態以面板為主控，Board 端僅接收 `ACTION_COMPLETED` / `ACTION_CANCELLED` 更新並反映 UI。
- Board 端動作按鈕長按 5 秒可回復為未完成狀態，僅影響本機顯示，不對外廣播。

#### 面板頁（index.html）

| `type` 值        | 常數                 | 主要 payload 欄位                                            |
| ---------------- | -------------------- | ------------------------------------------------------------ |
| `power_state_update`     | `POWER_STATE_UPDATE` | `powerState`, `isPowerVideoPlaying`, `clientId`, `timestamp` |
| `button_pressed` | `BUTTON_PRESSED`     | `button`, `function`, `beepEnabled`, `clientId`, `timestamp` |

---

### 3. SYNC_EVENTS — 前端 DOM / Window 事件

這些事件透過 `document.dispatchEvent()` 或 `window.dispatchEvent()` 在**同一頁面內**傳遞，不經過 WebSocket。
定義檔：`js/constants/sync-events-constants.js`（`SYNC_EVENTS`）

#### 工作階段事件（SyncManager 派發）

| 事件名稱                      | 常數                     | 說明               |
| ----------------------------- | ------------------------ | ------------------ |
| `sync_session_created`        | `SESSION_CREATED`        | 成功建立工作階段   |
| `sync_session_joined`         | `SESSION_JOINED`         | 成功加入工作階段   |
| `sync_session_left`           | `SESSION_LEFT`           | 離開工作階段       |
| `sync_session_restored`       | `SESSION_RESTORED`       | 從快取恢復工作階段 |
| `sync_session_joined_by_code` | `SESSION_JOINED_BY_CODE` | 透過分享代碼加入   |
| `sync_share_code_generated`   | `SHARE_CODE_GENERATED`   | 分享代碼已產生     |

#### WebSocket 連線事件

| 事件名稱                     | 常數                    | 說明                 |
| ---------------------------- | ----------------------- | -------------------- |
| `sync_connected`             | `CONNECTED`             | WebSocket 連線成功   |
| `sync_disconnected`          | `DISCONNECTED`          | WebSocket 中斷       |
| `sync_server_status_changed` | `SERVER_STATUS_CHANGED` | 伺服器狀態改變       |
| `sync_server_online`         | `SERVER_ONLINE`         | 伺服器上線           |
| `sync_server_offline`        | `SERVER_OFFLINE`        | 伺服器離線           |
| `sync_client_initialized`    | `CLIENT_INITIALIZED`    | 同步客戶端完成初始化 |

#### 狀態同步事件

| 事件名稱                       | 常數           | 說明                                              |
| ------------------------------ | -------------- | ------------------------------------------------- |
| `sync_state_update`            | `STATE_UPDATE` | 收到遠端狀態更新（承載所有 SYNC_DATA_TYPES 類型） |
| `experiment:sync:remote_state` | `REMOTE_STATE` | ExperimentSyncCore 中繼事件（board 端接收）       |

#### 實驗生命週期事件（前端本機派發）

| 事件名稱                | 常數                              | 說明           |
| ----------------------- | --------------------------------- | -------------- |
| `experiment_started`    | `EXPERIMENT_STARTED`              | 實驗開始       |
| `experiment_paused`     | `EXPERIMENT_PAUSED`               | 實驗暫停       |
| `experiment_resumed`    | `EXPERIMENT_RESUMED`              | 實驗繼續       |
| `experiment_stopped`    | `EXPERIMENT_STOPPED`              | 實驗停止       |
| `experiment_id_changed` | `EXPERIMENT_ID_CHANGED`           | 實驗 ID 已變更 |
| `combination_selected`  | `EXPERIMENT_COMBINATION_SELECTED` | 組合選擇記錄   |

#### 實驗中心事件（ExperimentHubManager 派發）

| 事件名稱                         | 常數                             | 說明         |
| -------------------------------- | -------------------------------- | ------------ |
| `experiment_hub_state_update`    | `EXPERIMENT_HUB_STATE_UPDATE`    | 中樞狀態更新 |
| `experiment_hub_id_update`       | `EXPERIMENT_HUB_ID_UPDATE`       | 中樞 ID 更新 |
| `experiment_hub_state_change`    | `EXPERIMENT_HUB_STATE_CHANGE`    | 中樞狀態改變 |
| `experiment_hub_connection_lost` | `EXPERIMENT_HUB_CONNECTION_LOST` | 中樞連線中斷 |

#### 其他 UI / 本機事件

| 事件名稱                    | 常數                        | 說明                                    |
| --------------------------- | --------------------------- | --------------------------------------- |
| `power_state_changed`       | `POWER_STATE_CHANGED`       | 電源狀態改變（本機 UI，不經 WebSocket） |
| `user_settings_reset`       | `USER_SETTINGS_RESET`       | 使用者設定已重設                        |
| `data_cleared`              | `DATA_CLEARED`              | WebSocket 斷線後清除同步資料            |
| `websocket_session_invalid` | `WEBSOCKET_SESSION_INVALID` | 工作階段無效（伺服器通知）              |
| `show_sync_panel`           | `SHOW_SYNC_PANEL`           | 開啟同步指示器面板                      |
| `sync_panel_updated`        | `PANEL_UPDATED`             | 同步面板 UI 已更新                      |

---

## 環境變數設定 (.env)

### 設定管理策略

環境變數由伺服器運行時需求決定。每個參數的詳細說明如下：

### 完整參數列表

```env
# 應用程式環境
NODE_ENV=production                  # 運行環境（development/production）

# 伺服器設定
PORT=7645                            # WebSocket 伺服器連接埠
HOST=0.0.0.0                         # 綁定地址（接受所有來源）

# CORS 設定
CORS_ORIGIN=http://localhost:7645    # 允許的請求來源（可用逗號分隔多個）

# 資料庫設定
DB_PATH=../runtime/database/experiment.db  # SQLite 資料庫檔案路徑（相對於 server 目錄）

# 工作階段設定（秒）
SESSION_TIMEOUT=1800                 # 工作階段超時（30 分鐘）
INACTIVE_TIMEOUT=600                 # 非活動超時（10 分鐘）
MAX_CLIENTS=6                        # 單工作階段最大客戶端數

# 分享代碼設定（秒）
SHARE_CODE_TIMEOUT=300               # 分享代碼有效期（5 分鐘）

# WebSocket 心跳設定（毫秒）
WS_HEARTBEAT_INTERVAL=30000          # 心跳間隔（30 秒）
WS_HEARTBEAT_TIMEOUT=60000           # 心跳超時（60 秒）

# WebSocket 速率限制
WS_RATE_LIMIT_CAPACITY=20            # 允許的最大訊息數
WS_RATE_LIMIT_REFILL_PER_SEC=10      # 每秒補充的訊息額度
WS_RATE_LIMIT_VIOLATION_THRESHOLD=5  # 違規次數閾值

# 低頻工作階段驗證（毫秒）
WS_SESSION_VALIDATION_INTERVAL=300000  # 5 分鐘驗證一次非活動工作階段

# 日誌設定
LOG_LEVEL=debug                      # 日誌級別（debug/info/warn/error）
```

### 參數說明

| 參數                                | 預設值                              | 說明                                       |
| ----------------------------------- | ----------------------------------- | ------------------------------------------ |
| `NODE_ENV`                          | `production`                        | 運行環境（影響日誌詳細度和最佳化）         |
| `PORT`                              | `7645`                              | WebSocket 和 HTTP 服務器的監聽連接埠       |
| `HOST`                              | `0.0.0.0`                           | 綁定地址（`0.0.0.0` 表示接受所有網路介面） |
| `CORS_ORIGIN`                       | `http://localhost:7645`             | CORS 允許來源（多個可用 `\|` 分隔）        |
| `DB_PATH`                           | `../runtime/database/experiment.db` | SQLite 資料庫檔案路徑                      |
| `SESSION_TIMEOUT`                   | `1800` (秒)                         | 工作階段無活動後自動過期時間               |
| `INACTIVE_TIMEOUT`                  | `600` (秒)                          | 客戶端無活動後標記為非活動                 |
| `MAX_CLIENTS`                       | `6`                                 | 單工作階段最多允許的客戶端連線數           |
| `SHARE_CODE_TIMEOUT`                | `300` (秒)                          | 分享代碼的有效期                           |
| `WS_HEARTBEAT_INTERVAL`             | `30000` (毫秒)                      | 伺服器向客戶端發送心跳的間隔               |
| `WS_HEARTBEAT_TIMEOUT`              | `60000` (毫秒)                      | 等待客戶端心跳回應的超時時間               |
| `WS_RATE_LIMIT_CAPACITY`            | `20`                                | 令牌桶初始容量                             |
| `WS_RATE_LIMIT_REFILL_PER_SEC`      | `10`                                | 每秒補充的令牌數                           |
| `WS_RATE_LIMIT_VIOLATION_THRESHOLD` | `5`                                 | 達此違規次數時斷開連線                     |
| `WS_SESSION_VALIDATION_INTERVAL`    | `300000` (毫秒)                     | 定期驗證工作階段的頻率                     |
| `LOG_LEVEL`                         | `debug`                             | 日誌記錄級別                               |

### 設定優先級

系統設定的優先級（高到低）：

1. **環境變數** (.env) - 最高優先級
2. **server/config/\*.js** - 預設值定義
3. **硬編碼常數** - 最低優先級

若需要改變運行行為，優先修改 `.env` 檔案，避免修改源代碼。

---

## 命名規範

為保持程式碼一致性和可讀性，全系統採用以下命名約定：

### 1. JavaScript 變數和函數

- **camelCase** (駝峰式命名)
- 範例: `sessionId`, `clientId`, `generateShareCode()`, `updateLastActive()`

### 2. 資料庫欄位

- **snake_case** (底線命名，遵循 SQLite 慣例)
- 範例: `session_id`, `created_at`, `last_activity`, `share_code`

### 3. 環境變數和常數

- **UPPER_SNAKE_CASE** (大寫底線命名)
- 範例: `SESSION_TIMEOUT`, `VALID_CREATE_CODE`, `WS_HEARTBEAT_INTERVAL`

### 4. 設定物件

- **camelCase** (設定物件屬性)
- 範例: `SERVER_CONFIG.session.timeout`, `DATABASE_CONFIG.options.cacheSize`

### 5. 類別和服務

- **PascalCase** (大駝峰式命名)
- 範例: `SessionService`, `ShareCodeService`, `WebSocketManager`

---

## 啟動指南

### 開發環境啟動

```powershell
# 1. 進入專案目錄
Set-Location -LiteralPath 'd:\OneDrive - 亞洲大學[Asia University]\1141\_新生活運動\_碩論\_機台MR教學\panel\server'

# 2. 安裝依賴 (首次)
npm install

# 3. 啟動開發伺服器
npm run dev

# 4. 確認伺服器執行
# 瀏覽器開啟: http://localhost:7645/api/health
# 應該看到: { "success": true, "message": "Server online", "timestamp": ... }
```

### 前端開發

```powershell
# 1. 確保後端伺服器執行中
# 2. 開啟前端頁面
# 瀏覽器開啟: http://localhost:7645/index.html
# 或: http://localhost:7645/board.html
```

---

## 實驗日誌運作方式

### 設計需求

**獨立運作模式（不加入工作階段）**：

- **機台面板 (index.html)**：實驗完成後自動下載 JSONL 檔案到本機
- **實驗管理 (experiment.html)**：實驗結束後自動回傳伺服器備份

**連線同步模式（加入工作階段）**：

- 透過 WebSocket 廣播實驗進度和動作
- 機台面板與實驗管理即時連動
- 實驗管理的日誌作為最後的實驗分析依據

### 資料流對比

#### 機台面板（index.html）

```
使用者操作 → PanelExperimentLog.logActionComplete()
          ↓
    logs 陣列累積（記憶體）
          ↓
    實驗完成 → PanelExperimentManager.stopExperiment()
          ↓
    呼叫 panelExperimentLog.stopRecording()
          ↓
    自動下載 JSONL 到本機
    (檔名: panel_exp_{實驗ID}_{時間戳}.jsonl)
```

#### 實驗管理（experiment.html）

```
使用者操作 → ExperimentLogManager.logGestureMarked()
          ↓
    pendingLogs 累積（記憶體）
          ↓
    達到 bufferSize(10) 或實驗完成
          ↓
    寫入 IndexedDB (ExperimentLogsDB)
          ↓
    【已實作】回傳伺服器 /api/experiment-logs/save
          ↓
    儲存到 runtime/experiment-data/{實驗ID}_{時間戳}.jsonl
          ↓
    完成（伺服器 + 本機雙備份）
```

#### 實驗日誌檢視與管理

前端檢視日誌時的流程：

```
1. 前端請求 → GET /api/experiment-logs/list
               ↓
2. 伺服器讀取 runtime/experiment-data/ 目錄
               ↓
3. 回傳檔案列表（檔名、大小、修改時間）
               ↓
4. 前端顯示日誌列表
               ↓
5. 使用者點擊查看 → GET /api/experiment-logs/read/{filename}
                     ↓
6. 伺服器讀取 JSONL 檔案內容
                     ↓
7. 回傳完整日誌內容（JSON 格式）
                     ↓
8. 前端解析並顯示統計資訊
```

**關鍵設計**：

- 檔案儲存在**伺服器端** `runtime/experiment-data/` 目錄
- 前端透過**伺服器 API** 讀取檔案，而非直接存取檔案系統
- 日誌目錄路徑可在 `config.json` 中設定（`experiment.logsDirectory`）

#### 連線同步模式

```
機台面板 操作 → WebSocket 廣播
                ↓
         實驗管理即時更新 UI
                ↓
         兩邊同步顯示進度
                ↓
         實驗完成時各自備份
         （機台下載 + 管理上傳）
```
