# Node.js 伺服器重構版本 架構藍圖

## 專案概述

### 整體架構圖

```
┌─────────────────────────────────────────────────────────────┐
│                    前端系統 (Browser)                         │
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
│  │  │ WebSocket    │  │   REST API   │                │   │
│  │  │   Client     │  │(/api/health) │                │   │
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
├── metrics.js               # 效能監控與度量統計
├── package.json             # 後端依賴管理
├── .env                              # 環境變數設定（執行時）
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
│   └── （日誌寫入由 routes/record.js 直接處理）
├── websocket/
│   ├── WSServer.js          # WebSocket 伺服器核心封裝
│   ├── ConnectionManager.js # 連線管理（clientId 對應、重連偵測）
│   ├── SessionManager.js    # 工作階段管理（房間管理）
│   ├── BroadcastManager.js  # 廣播管理（單播、房間廣播、全域廣播）
│   └── MessageHandler.js    # 訊息處理器（auth、heartbeat、state_update）
├── routes/
│   ├── sync.js              # 同步 API（工作階段、分享代碼、驗證）
│   ├── record.js            # 實驗日誌 API（record 使用；JSONL 檔案讀寫）
│   ├── experiment.js        # 實驗 API（ID 產生）
│   └── health.js            # 心跳檢測 API (`GET /api/health`)
├── middleware/
│   └── (目前為空，預留擴展)
├── utils/
│   ├── logger.js            # 日誌工具（console 包裝）
│   ├── idGenerator.js        # ID 產生工具
│   ├── checksum.js           # 校驗碼計算
│   ├── sync-role-guard.js    # operator 角色衝突檢查與 clientType 正規化
│   └── time.js               # 時間工具


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
└── (工作階段還原資料)

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
| **random-utils.js** | 匯出函數/物件 | 可重現隨機化工具。物件：RandomUtils。函數：createSeededRandom, shuffleArray, getCombinationUnitIds, generateExperimentId |
| **session-restore-events.js** | 匯出函數 | 工作階段快照轉譯器。函數：dispatchSessionRestoreEvents() |

#### js/panel/ - 面板控制模組

| 檔案                                   | class                     | 主要功能                                                                                                                                                                                                               |
| -------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **panel-page-manager.js**     | `PanelPageManager`     | 面板頁面初始化協調。方法：initialize, onInitializationComplete, _initializeExperimentUIAndData, _initializePanelRuntimeBindings                                                                   |
| **panel-button-manager.js**   | `ButtonManager`        | 按鈕互動與邏輯。方法：loadButtonFunctions, clearButtonFunctions, simulateButtonClick, setupEventListeners, updateExperimentButtonStyles, handleButtonPressed                                                           |
| **panel-ui-manager.js**       | `PanelUIManager`       | UI 控制項與視覺設定。方法：updateScale, updateTopSpacer, updateBottomSpacer, updatePowerScale, updateButtonLabelVisibility, updateButtonColorVisibility, updateTouchVisuals, setupEventListeners, initializeUIControls |
| **panel-power-control.js**    | `PowerControl`         | 電源狀態管理。方法：setPowerState, updatePowerUIWithoutSync, updateMediaControlButtons, dispatchPowerStateChanged, quickPowerOn, ensurePowerOffForExperimentStart, highlightShutdownIfNeeded, setPowerSwitchHighlight, _updatePowerKnobUI |
| **panel-media-manager.js**    | `MediaManager`         | 媒體預載入與快取。方法：setupEventListeners, playMedia, processMediaSrc, setupVideoElement, setupImageElement, playMediaInArea, preloadMedia, preloadCombinationMedia, stopHomePageLoop, playHomePageLoop              |
| **panel-logger.js**           | `PanelLogger`          | 操作日誌記錄。方法：initializeDOMElements, setupDOMElements, isExperimentMode, formatDateTime, getExperimentInfo, logAction, toggleLogger, showLogger, hideLogger, clearLog, exportLog                                 |
| **panel-sync-manager.js**     | `PanelSyncManager`     | 面板同步管理。方法：setupModuleReferences, setupSyncEventListeners, handleSyncExperimentStart, handleSyncExperimentPaused, handleSyncExperimentResumed, handleSyncExperimentStopped, handleSyncExperimentIdUpdate, handleSyncParticipantNameUpdate, handleSyncActionCompleted, handleSyncActionCancelled |
| **panel-init.js**             | 匯出函數               | Panel 初始化協調。函數：initializePanelManagers(pageManager) |

#### js/sync/ - 同步模組

| 檔案                                    | class                         | 主要功能                                                                                                                                                                                                                           |
| --------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **sync-manager.js**            | `SyncManager`              | 同步管理主入口。方法：initialize, setupInitialization。常數：ROLE, STATUS, ROLE_TEXTS, STATUS_TEXTS, PAGE, PAGE_LIST                                                                                                               |
| **sync-manager-core.js**       | `SyncManagerCore`          | 同步核心邏輯。方法：initDependencies, getBaseUrl, generateShareUrl, createSession, joinSession, restoreSession, syncState, processOfflineQueue                                                             |
| **sync-manager-ui.js**         | `SyncManagerUI`            | UI 膠囊指示器與控制面板。方法：initialize, createCapsuleIndicator, createControlPanel, updateIndicator, updateUIState, showPanel, hidePanel, setupEventListeners, bindEvents                                                       |
| **sync-sessions-modal.js**     | `SyncSessionsModal`        | 工作階段管理 Modal。方法：initialize, showModal, loadSessionsData, renderSessionsList, bindEvents, refreshSessionsList, updateBatchOperationButtons                                                                        |
| **sync-confirm-dialog.js**     | `SyncConfirmDialogManager` | 加入工作階段確認對話。方法：showJoinConfirmation                                                                                                                                                                                   |
| **sync-client.js**             | `SyncClient`               | WebSocket + REST API 同步客戶端。方法：setupGlobalEventHandlers, initializeSync, setupWebSocketHandlers, createSession, joinSession, restoreSession, syncState, getShareCodeInfo, startHeartbeatCheck, loadState, saveState, getStoredSessionInfo        |
| **experiment-sync-core.js**    | `ExperimentSyncCore`       | 實驗同步核心。方法：syncState, safeBroadcast, broadcastExperimentStart/Stop。由 board-experiment-sync.js 透過 ES module 使用 |
| **indicator-manager.js**       | `IndicatorManager`         | 同步狀態指示器管理。方法：initialize, updateIndicator, showIndicator, hideIndicator, setStatus, animateIndicator                                                                                                                   |

#### js/experiment/ - 實驗管理模組

```
js/experiment/
├── experiment-action-handler.js      # ExperimentActionHandler - 動作處理與事件路由，支援注入 FlowManager、HubManager
├── experiment-combination-manager.js # ExperimentCombinationManager - 組合載入、快取還原、隨機化與預設組合套用
├── experiment-flow-manager.js        # ExperimentFlowManager - 實驗流程協調（開始/暫停/停止/步進），支援 setDeferCompletion 以延後完成狀態
├── experiment-hub-manager.js         # ExperimentHubManager - 與實驗中樞/同步相關的延遲初始化與工作階段管理
├── experiment-state-manager.js       # ExperimentStateManager - 實驗狀態管理與持久化（從 js/core/ 遷移而來）
├── experiment-system-manager.js      # ExperimentSystemManager - 實驗系統統一管理器，協調各模組
├── experiment-timer.js               # ExperimentTimerManager - 統一計時器管理器
└── experiment-ui-manager.js          # ExperimentUIManager - 實驗 UI 元件、計時器、按鈕狀態與視覺提示管理
```

#### js/board/ - 實驗頁面專用模組

```
js/board/
├── board-page-manager.js         # BoardPageManager - 實驗頁面腳本載入與初始化協調
├── board-init.js                 # Board 初始化協調（initializeBoardManagers）
├── board-sync-io.js              # BoardSyncIO - 同步收發邏輯集中
├── board-experiment-sync.js      # ExperimentSyncAdapter - 同步狀態廣播轉接
├── board-ui-manager.js           # BoardUIManager - Board UI 與手勢卡片渲染
├── board-gesture-utils.js        # BoardGestureUtils - 手勢處理工具
└── experiment-simulator.js       # ExperimentSimulator - 實驗流程模擬工具（開發/測試用）
```

**ExperimentSimulator （v2.5.0+）**

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

**Panel 頁面初始化順序** (`PanelPageManager`):

1. `PanelPageManager.initialize()`
2. `initializePanelManagers(this)`（位於 `js/panel/panel-init.js`）：集中建立並注入 Sync / Hub / Flow / UI / Logger / Media 等管理器
3. `_initializeExperimentUIAndData()`：載入 scenario/unit 資料並初始化實驗 UI
4. `_initializePanelRuntimeBindings()`：綁定按鈕、事件與執行期依賴

**Board 頁面載入順序** (`BoardPageManager`):

Board 由 `loadDependencies()` 使用 `Promise.all` 並行載入核心依賴；模組建立與注入由 `initializeBoardManagers(this)`（`js/board/board-init.js`）集中協調。

- **核心基礎設施**: `console-manager.js`, `config.js`, `websocket-client.js`, `time-sync-manager.js`
- **實驗狀態**: `experiment-state-manager.js`
- **同步系統**: `sync-client.js`, `experiment-hub-manager.js`
- **核心工具**: `data-loader.js`, `random-utils.js`
- **實驗模組**: `experiment-combination-manager.js`, `experiment-flow-manager.js`, `experiment-action-handler.js`, `experiment-ui-manager.js`, `experiment-system-manager.js`, `experiment-timer.js`
- **Board 專用**: `board-experiment-sync.js`, `board-ui-manager.js`, `board-gesture-utils.js`
- **同步與對話框**: `experiment-sync-core.js`, `sync-confirm-dialog.js`, `sync-sessions-modal.js`, `js/constants/sync-events-constants.js` (ES module), `sync-manager.js` (ES module)

`sync-manager.js` 作為 ES module 會透過 import 自動載入子模組：`sync-manager-core.js`, `sync-manager-ui.js`, `sync-manager-sessions.js`

架構要點：

- 各頁面的 PageManager 負責頁面初始化協調。
- `panel-init.js` / `board-init.js` 負責管理器建立與依賴注入。
- `record/index.js` 統一匯出 `RecordManager` / `recordView` 與紀錄子模組。

**初始化依賴關係**:

```

PanelPageManager.initialize()
├─ initializeModules()
│  └─ initializePanelManagers(this)
├─ initializeRemainingComponents()
│  ├─ _initializeExperimentUIAndData()
│  └─ _initializePanelRuntimeBindings()
└─ 完成初始化

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
│ │ ├── record-view-modal.css
│ │ ├── records.css
│ │ ├── stats.css
│ │ └── units.css
│ └── panels/
│   ├── experiment-panel.css
│   ├── record-panel.css
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
├── eslint.config.js # ESLint 設定
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

版本號格式: `major.minor.gitHash` (如: `2.5.da4fff5`)

---

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

校驗碼演算法由後端 `server/utils/checksum.js` 維護，架構文件僅保留資料模型。

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

`clientId` 為分頁級唯一識別，實作細節以前端同步模組為準。

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

產生與同步細節以 `random-utils.js`、`sync-client.js`、`server/websocket/*` 為準。

---

### 5. **狀態更新 (State Update)**

**定義**: 即時同步的狀態變化事件。

**WebSocket 訊息封包**:

```javascript
interface WSMessage {
  type: string;      // 訊息類型
  timestamp: number; // 時間戳（毫秒）
  sessionId: string; // 工作階段 ID
  clientId: string;  // 發送者 clientId
  data: any;         // 業務 payload
}
```

訊息類型請以「WebSocket 訊息類型與同步事件參考」章節為準：
- WS 傳輸層：`shared/ws-protocol-constants.js`
- 業務廣播層：`js/constants/sync-events-constants.js`

---

## 資料流說明

### 本機模式（無同步）

```
使用者操作
  -> PanelPageManager / ExperimentStateManager
  -> localStorage（狀態持久化）
  -> PanelLogger（可匯出本機 JSON）
  -> RecordManager -> IndexedDB（實驗事件緩衝區）
```

### 同步模式（多裝置）

```
裝置 A 狀態事件
  -> sync-client.js / websocket-client.js
  -> WebSocket Server
  -> 廣播到同工作階段裝置 B/C/...
  -> 各端 ExperimentStateManager 更新
  -> UI 即時同步
```

### 日誌寫入伺服器（JSONL）

```
RecordManager（記憶體/IndexedDB）
  -> POST /api/record/save
  -> runtime/experiment-data/*.jsonl
```

### 校時機制（一次性）

```
auth_success（含 serverTime）
  -> timeSyncManager.syncWithWebSocket(serverTime)
  -> 更新 timeOffset
  -> 後續以 TimeSyncManager.getServerTime() 取時
```

---

## 運作模式與實驗中樞註冊 (Operating Modes)

### 設計原則

系統依是否具備有效 `sessionId + clientId` 切換模式：

- 獨立運作模式（本機）：
  - 不建立同步連線。
  - 實驗 ID 與狀態僅保留本機。
- 同步運作模式（協作）：
  - 建立 WebSocket 連線並加入工作階段。
  - 實驗 ID 變更需註冊至實驗中樞。

### 架構規則

- `ExperimentHubManager.isInSyncMode()` 作為註冊中樞與同步廣播的主要判斷入口。
- 所有實驗 ID 產生/更新流程均遵循：
  - 同步模式：註冊中樞並廣播（only in sync mode）。
  - 本機模式：只更新本機狀態，不對外同步。

---

## 重新連線與離線機制 (Reconnect & Offline System)

### 前端重點

| 面向 | 設計重點 | 前端行為 |
| ---- | -------- | -------- |
| 連線身分還原 | 分頁重新整理後維持 `clientId/sessionId/role` | 優先從 `sessionStorage` 還原識別並重送 `auth` |
| 多分頁與跨工作階段 | 分頁隔離 + 跨分頁共用 | `sessionStorage` 保存分頁識別；`localStorage` 保存跨分頁資訊（如 `sync_session_id`） |
| 日誌持久化 | 本機快取與伺服器備份分離 | `IndexedDB` 緩衝/持久化；完成時可經 `/api/record/*` 寫入 JSONL |
| 離線容錯 | 斷線期間不中斷操作 | `offlineQueue` 暫存、排序去重，重連後依序重送 |

### 儲存層策略

| 儲存方式 | 主要用途 | 重新整理 | 多分頁 | 關閉瀏覽器 |
| -------- | -------- | -------- | ------ | ---------- |
| `sessionStorage` | 分頁級重連（推薦） | 保留 | 隔離 | 消失 |
| `localStorage` | 跨工作階段還原 | 保留 | 共用 | 保留 |
| `IndexedDB` | 實驗日誌快取 | 保留 | 共用 | 保留 |
| `memory` | 離線佇列暫存 | 消失 | 隔離 | 消失 |


### 重新連線摘要流程

```
connect -> auth(clientId, sessionId, role) -> auth_success(isReconnect, serverTime)
     -> session_state -> client_reconnected(others)
     -> processOfflineQueue() (if any)
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
| GET    | `/api/record/list`               | 列出所有日誌檔案 |
| POST   | `/api/record/save`               | 儲存日誌檔案     |
| GET    | `/api/record/read/:filename`     | 讀取日誌檔案內容 |
| DELETE | `/api/record/delete/:filename`   | 刪除日誌檔案     |

---

## WebSocket 訊息類型與同步事件參考

### 1. WS_PROTOCOL — WebSocket 傳輸層訊息類型

定義檔：`shared/ws-protocol-constants.js`

#### C2S（客戶端 → 伺服器）

| `type` 值                | 說明                                       | 伺服器處理器                 |
| ------------------------ | ------------------------------------------ | ---------------------------- |
| `auth`                   | 認證連線，建立工作階段綁定                 | `handleAuth`                 |
| `heartbeat`              | 心跳，維持連線活動中                       | `handleHeartbeat`            |
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
| `participant_name_update` | `PARTICIPANT_NAME_UPDATE` | board                    | `participantName`, `timestamp`           |
| `combination_selected`  | `COMBINATION_SELECTED`    | board / 面板             | `combination`, `timestamp`               |

#### 動作與手勢（board 頁）

| `type` 值                | 常數                     | 主要 payload 欄位                                                          |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------- |
| `action_completed`       | `ACTION_COMPLETED`       | `action_id`, `step_id`, `unit_id`, `client_id`, `duration_ms`, `experiment_id`, `combination_id`, `participant_name`, `timestamp` |
| `action_cancelled`       | `ACTION_CANCELLED`       | `action_id`, `gesture_index`, `client_id`, `timestamp`                     |
| `gesture_marked`         | `GESTURE_MARKED`         | `step_index`, `gesture_name`, `mark_status`, `timer_value`, `timestamp`    |
| `gesture_step_completed` | `GESTURE_STEP_COMPLETED` | `step_index`, `gesture_name`, `timer_value`, `timestamp`                   |

**補充（action 同步方向）**
- action 狀態以面板為主控，Board 端僅接收 `ACTION_COMPLETED` / `ACTION_CANCELLED` 更新並反映 UI。

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
| `sync_session_restored`       | `SESSION_RESTORED`       | 從快取還原工作階段 |
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


### 設定範例

```env
NODE_ENV=production
PORT=7645
HOST=0.0.0.0
CORS_ORIGIN=http://localhost:7645
DB_PATH=../runtime/database/experiment.db
```

完整參數與預設值請以 `server/.env.example` 及下方「參數說明」表格為準。

### 參數說明

| 參數                                | 預設值                              | 說明                                       |
| ----------------------------------- | ----------------------------------- | ------------------------------------------ |
| `NODE_ENV`                          | `production`                        | 執行環境（影響日誌詳細度和最佳化）         |
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

若需要改變執行行為，優先修改 `.env` 檔案，避免修改源代碼。

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

### 架構摘要

- 本機模式：面板端可在實驗結束後輸出 JSONL 供本機儲存。
- 同步模式：事件透過 WebSocket 廣播，管理端與面板端維持進度一致。
- 管理端日誌採用記憶體緩衝區 + IndexedDB，並可透過 API 寫入伺服器檔案備份。

### 儲存與存取邊界

- 伺服器端儲存路徑：`runtime/experiment-data/`
- 前端僅透過 API 存取日誌：`/api/record/*`
- 日誌目錄可由 `config.json` 的 `experiment.logsDirectory` 配置
