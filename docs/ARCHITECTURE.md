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
│  │  │  MainApp    │  │SyncManager  │  │Experiment│   │   │
│  │  │  (初始化)   │  │(工作階段)   │  │  Manager │   │   │
│  │  └─────────────┘  └─────────────┘  └──────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  通訊層 (Communication)                              │   │
│  │  ┌──────────────┐  ┌──────────────┐                │   │
│  │  │ WebSocket    │  │  HTTP HEAD   │                │   │
│  │  │   Client     │  │(心跳檢測 10s)│                │   │
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

## 目錄結構

```
panel/
├── server/                           # Node.js 後端（WebSocket 伺服器）
│   ├── index.js                      # 主入口：Express + WebSocket 伺服器
│   ├── package.json                  # 依賴管理
│   ├── .env                          # 環境變數設定
│   ├── .env.example                  # 環境變數範例
│   │
│   ├── config/                       # 設定檔案
│   │   ├── server.js                 # 伺服器設定（連接埠、CORS 等）
│   │   ├── database.js               # SQLite 連線設定
│   │   └── constants.js              # 常數定義
│   │
│   ├── database/                     # 資料庫層
│   │   ├── connection.js             # node:sqlite DatabaseSync 實例
│   │   └── schema.js                 # 資料庫結構初始化
│   │
│   ├── services/                     # 業務邏輯層
│   │   ├── SessionService.js         # 工作階段管理
│   │   ├── ShareCodeService.js       # 分享代碼管理
│   │   ├── ExperimentService.js      # 實驗服務
│   │   └── LogService.js             # 日誌服務
│   │
│   ├── websocket/                    # WebSocket 層
│   │   ├── WSServer.js               # WebSocket 伺服器封裝
│   │   ├── ConnectionManager.js      # 連線管理器
│   │   ├── SessionManager.js         # 工作階段管理器
│   │   ├── BroadcastManager.js       # 廣播管理器
│   │   └── MessageHandler.js         # 訊息處理器（含校時）
│   │
│   ├── routes/                       # HTTP 路由層
│   │   ├── health.js                 # 心跳檢測 API
│   │   ├── sync.js                   # 同步 API（工作階段、分享代碼）
│   │   ├── experiment-logs.js        # 實驗日誌 API（JSONL 檔案管理）
│   │   ├── experiment.js             # 實驗 API
│   │   └── logs.js                   # 日誌 API
│   │
│   ├── middleware/                   # 中間件（目前為空）
│   │
│   └── utils/                        # 工具函數
│       ├── logger.js                 # 日誌工具
│       ├── idGenerator.js            # ID 產生器 (sessionId, shareCode)
│       ├── checksum.js               # 校驗碼計算
│       └── time.js                   # 時間處理工具
│
├── runtime/                          # 執行時資料（不上傳 GitHub）
│   ├── database/                     # SQLite 資料庫
│   │   └── experiment.db             # 儲存 sessions, share_codes, experiment_ids
│   ├── experiment-data/              # 實驗日誌檔案（JSONL 格式）
│   │   ├── {實驗ID}_{時間戳}.jsonl  # 例如：JHWH4A_1767975514075.jsonl
│   │   └── ...                       # 由伺服器 API 自動管理
│   └── sessions/                     # 工作階段資料（用於重連恢復）
│
├── data/                             # 靜態資料目錄
│   ├── config.json                   # 前端業務設定
│   ├── buttons.json                  # 按鈕設定
│   ├── units.json                    # 單元設定
│   └── scenarios.json                # 場景設定
│
├── js/                               # 前端 JavaScript
│   ├── core/                         # 核心模組
│   │   ├── main.js                   # 初始化流程
│   │   ├── config.js                 # 設定管理與版本管理
│   │   ├── console-manager.js        # 主控台管理
│   │   ├── data-loader.js            # 資料載入器
│   │   ├── websocket-client.js       # WebSocket 客戶端（含校時）
│   │   ├── experiment-hub-client.js  # WebSocket 版本實驗中樞
│   │   ├── time-sync-manager.js      # 時間同步與格式化
│   │   ├── experiment-state-manager.js # 本機狀態管理
│   │   ├── realtime-communication.js # 即時通訊管理
│   │   ├── sync-events-constants.js  # 同步事件常數
│   │   ├── random-utils.js           # 隨機工具
│   │   └── version-manager.js        # 版本管理（已移至 config.js）
│   │
│   ├── experiment/                   # 實驗管理模組
│   │   ├── experiment-action-manager.js    # 實驗動作管理
│   │   ├── experiment-export-manager.js    # 實驗匯出管理
│   │   ├── experiment-gesture-utils.js     # 手勢工具
│   │   ├── experiment-log-manager.js       # 實驗日誌管理
│   │   ├── experiment-log-ui.js            # 實驗日誌UI
│   │   ├── experiment-page-manager.js      # 實驗頁面管理
│   │   ├── experiment-sync-manager.js      # 實驗同步管理
│   │   ├── experiment-timer-utils.js       # 計時器工具
│   │   └── experiment-ui-controls.js       # 實驗UI控制
│   │
│   ├── panel/                        # 面板控制模組
│   │   ├── panel-manager.js                # 面板管理器
│   │   ├── panel-action-manager.js         # 面板動作管理
│   │   ├── panel-button-manager.js         # 按鈕管理
│   │   ├── panel-experiment-manager.js     # 面板實驗管理
│   │   ├── panel-experiment-log.js         # 面板實驗日誌
│   │   ├── panel-experiment-sync-receiver.js # 實驗同步接收器
│   │   ├── panel-media-manager.js          # 媒體管理
│   │   ├── panel-power-control.js          # 電源控制
│   │   ├── panel-sync-operator.js          # 同步操作器
│   │   ├── panel-ui-controls.js            # 面板UI控制
│   │   ├── combination-selector.js         # 組合選擇器
│   │   ├── panel-logger.js                 # 面板操作日誌
│   │   └── panel-experiment-log.js         # 面板實驗日誌
│   │
│   ├── sync/                         # 同步模組
│   │   ├── sync-client.js            # WebSocket 版本（心跳檢測 10s）
│   │   ├── sync-manager.js           # 工作階段管理
│   │   ├── sync-manager-ui.js        # UI 管理（膠囊指示器）
│   │   ├── sync-manager-sessions.js  # 工作階段UI管理
│   │   ├── sync-manager-qr.js        # QR Code 管理
│   │   ├── sync-confirm-dialog.js    # 確認對話框
│   │   ├── sync-manager-core.js      # 同步核心邏輯
│   │   └── experiment-hub-manager.js # 實驗中樞管理
│
├── css/                              # 樣式表
├── assets/                           # 資源檔案
├── docs/                             # 文件
│   ├── ARCHITECTURE.md               # 架構文件（本文件）
│   └── scenarios_structure.md        # 場景結構說明
│
├── index.html                        # 機台面板（受試者端）
├── experiment.html                   # 實驗管理（研究者端）
└── README.md                         # 專案說明

```

---

## 版本管理系統

專案使用 git commit hash 作為版本識別碼，提供更好的版本追蹤和

### 自動化版本更新

```bash
# 更新所有版本資訊（推薦）
npm run version:update

# 僅更新 git commit hash
npm run version:hash

# 僅更新版本號
npm run version:version

# 查看目前版本狀態
npm run version:status
```

### 手動版本更新

```bash
# 使用 Node.js 腳本
node scripts/update-version.js all
node scripts/update-version.js status
```

### Git Commit Hash 說明

- **完整 hash**: 40 位字符 (如: `09f31f10f01bbc67831146436a49f6de71c02b46`)
- **短 hash**: 預設 7 位 (如: `09f31f1`)
- **專案使用**: 7 位短 hash (如: `09f31f1`)

版本號格式: `major.minor.git-hash` (如: `1.5.09f31`)

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

**產生機制** (前端):

```javascript
function generateNewExperimentId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
```

**產生機制** (後端 - 保留但不常用):

```javascript
function generateExperimentId() {
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;

  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let randomStr = "";
  for (let i = 0; i < 4; i++) {
    randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return `EXP${dateStr}${randomStr}`; // 例：EXP20260109ABCD
}
```

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
const syncClient = window.syncManager?.core?.syncClient;
const sessionId = syncClient?.getSessionId?.();
const clientId = syncClient?.clientId;
const hasSession = sessionId && clientId;
return hasSession; // true = 同步模式，false = 獨立模式
```

### 實驗中樞註冊邏輯

**修正**: 所有實驗 ID 產生與註冊都需要檢查模式

```javascript
// 產生新實驗 ID
if (window.experimentHubManager?.isInSyncMode?.()) {
  // 同步模式：註冊到中樞
  window.experimentHubManager.registerExperimentId(newId, "source");
} else {
  // 獨立模式：僅存本機
  Logger.debug(`[獨立模式] 實驗ID僅存本機: ${newId}`);
}
```

**涵蓋位置**:

1. ExperimentStateManager.generateNewExperimentId()
2. PanelExperimentManager.startExperiment()
3. PanelExperimentManager.autoGenerateExperimentId()
4. ExperimentPageManager.generateNewExperimentIdWithHub()
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
        if (serverTime && window.timeSyncManager) {
          window.timeSyncManager.syncWithWebSocket(serverTime);
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
 │  ├─ 逐個調用 syncState()
 │  └─ 成功後移除佇列
 │   syncState() 調用失敗
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

### 模組依賴關係圖

```
時間同步管理器 ────┐
設定管理器 ────────┤
日誌系統 ──────────┤
                  ├──→ WebSocket Client ──→ SyncManager ──┐
                  │                                         │
                  └──────────────────────────────────────→ │
                                                            ├──→ 實驗中樞管理器
                                                            ├──→ UI控制模組
                                                            ├──→ 按鈕管理器
                                                            └──→ 媒體管理器
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

事件型別定義請參考上方核心概念章節的 `WS_MESSAGE_TYPES`。

#### 客戶端發送

| 事件                | 說明         | 資料格式                        |
| ------------------- | ------------ | ------------------------------- |
| `auth`              | 認證連線     | `{ sessionId, clientId, role }` |
| `heartbeat`         | 心跳保持連線 | `{ clientId, timestamp }`       |
| `state_update`      | 狀態更新     | `{ type, data }`                |
| `experiment_action` | 實驗操作     | `{ action, experimentId, ... }` |

#### 伺服器廣播

| 事件                   | 說明         | 資料格式                              |
| ---------------------- | ------------ | ------------------------------------- |
| `connected`            | 連線成功     | `{ wsConnectionId, serverTime }`      |
| `session_state`        | 工作階段狀態 | `{ sessionId, state, clients }`       |
| `experiment_started`   | 實驗開始     | `{ experimentId, source, timestamp }` |
| `experiment_paused`    | 實驗暫停     | `{ experimentId, source }`            |
| `experiment_resumed`   | 實驗繼續     | `{ experimentId, source }`            |
| `experiment_stopped`   | 實驗停止     | `{ experimentId, source }`            |
| `experiment_id_update` | 實驗 ID 更新 | `{ experimentId, timestamp }`         |
| `client_joined`        | 客戶端加入   | `{ clientId, role }`                  |
| `client_left`          | 客戶端退出   | `{ clientId }`                        |
| `error`                | 錯誤訊息     | `{ code, message }`                   |

---

## 資料庫結構

現有的 SQLite 資料庫結構表結構如下：

### 資料表

#### 1. sessions (工作階段表)

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL,
  data LONGTEXT NOT NULL,  -- JSON 格式
  is_active INTEGER DEFAULT 1
);
CREATE INDEX idx_sessions_created_at ON sessions(created_at);
CREATE INDEX idx_sessions_last_activity ON sessions(last_activity);
```

#### 2. share_codes (分享代碼表)

```sql
CREATE TABLE share_codes (
  code TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER DEFAULT 0,
  used_at INTEGER,
  used_by TEXT,
  expired INTEGER DEFAULT 0,
  expired_at INTEGER,
  expired_reason TEXT,
  created_by TEXT,
  checksum_valid INTEGER DEFAULT 1,
  single_use INTEGER DEFAULT 1,
  data LONGTEXT NOT NULL,  -- JSON 格式
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
CREATE INDEX idx_share_codes_session_id ON share_codes(session_id);
CREATE INDEX idx_share_codes_expires_at ON share_codes(expires_at);
CREATE INDEX idx_share_codes_used ON share_codes(used);
```

#### 3. experiment_ids (實驗 ID 表)

```sql
CREATE TABLE experiment_ids (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL UNIQUE,
  session_id TEXT,
  created_at INTEGER NOT NULL,
  data LONGTEXT NOT NULL  -- JSON 格式
);
CREATE INDEX idx_experiment_ids_experiment_id ON experiment_ids(experiment_id);
CREATE INDEX idx_experiment_ids_session_id ON experiment_ids(session_id);
```

#### 4. state_updates (狀態更新日誌表)

```sql
CREATE TABLE state_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  device_id TEXT,
  update_type TEXT,
  data LONGTEXT,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
CREATE INDEX idx_state_updates_session_id ON state_updates(session_id);
CREATE INDEX idx_state_updates_timestamp ON state_updates(timestamp);
```

### node:sqlite 設定

````javascript
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("./runtime/database/experiment.db");

// 性能優化設定（使用 exec 執行 PRAGMA）
db.exec("PRAGMA journal_mode = WAL;"); // 寫前日誌模式（提高並發）
db.exec("PRAGMA synchronous = NORMAL;"); // 適度同步（性能與安全平衡）
db.exec("PRAGMA cache_size = -64000;"); // 64MB 快取
db.exec("PRAGMA temp_store = MEMORY;"); // 將暫存表放在記憶體中
---

## package.json 設定

```json
{
  "name": "panel-backend",
  "version": "2.1.0",
  "description": "Node.js + WebSocket backend for experiment panel synchronization",
  "main": "index.js",
  "type": "module",
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": ["experiment", "sync", "websocket", "realtime"],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "express": "^4.21.2",
    "ws": "^8.19.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7"
  },
  "devDependencies": {
    "nodemon": "^3.1.9"
  },
  "engines": {
    "node": ">=24.12.0"
  }
}
````

---

## 環境變數設定 (.env)

### 設定管理策略

**重要**: 為避免設定重複和衝突，系統採用以下分工：

1. **後端執行設定** → `.env` 控制
   - 伺服器連接埠、主機、資料庫路徑
   - 超時設定 (Session, ShareCode, Cleanup)
   - WebSocket 設定 (心跳間隔)
   - CORS 和日誌設定

2. **前端業務設定** → `config.json` 控制
   - UI 顯示設定 (縮放、標籤顯示)
   - 實驗組合設定
   - 時區設定
   - 多裝置同步開關狀態

```env
# 伺服器設定
NODE_ENV=development
PORT=7645
HOST=0.0.0.0

# 資料庫設定
DB_PATH=../runtime/database/experiment.db

# 工作階段設定
SESSION_TIMEOUT=1800
INACTIVE_TIMEOUT=600
MAX_CLIENTS=6

# 分享代碼設定
SHARE_CODE_TIMEOUT=300

# 清理設定
CLEANUP_INTERVAL=120000

# WebSocket 設定
WS_HEARTBEAT_INTERVAL=30000
WS_HEARTBEAT_TIMEOUT=60000

# CORS 設定
CORS_ORIGIN=*

# 日誌設定
LOG_LEVEL=debug
```

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
# 或: http://localhost:7645/experiment.html
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

### 後端支援

**Node.js 實驗日誌 API** (`server/routes/experiment-logs.js`)：

- `GET /api/experiment-logs/list` - 列出所有日誌檔案（含檔案名稱、大小、修改時間）
- `POST /api/experiment-logs/save` - 儲存日誌到 runtime/experiment-data/
- `GET /api/experiment-logs/read/:filename` - 讀取 JSONL 檔案完整內容
- `DELETE /api/experiment-logs/delete/:filename` - 刪除日誌檔案

**檔案命名規範**：

- runtime 資料夾：`{實驗ID}_{時間戳}.jsonl`（例如：`JHWH4A_1767975514075.jsonl`）
- 本機下載：`experiment_log_{實驗ID}.jsonl`（例如：`experiment_log_JHWH4A.jsonl`）

**前端實作**：

- `js/experiment/experiment-log-ui.js` - 日誌 UI 管理
  - `loadExperimentLogs()` - 載入日誌列表（透過 `/list` API）
  - `viewLogDetails()` - 檢視日誌詳情（透過 `/read/:filename` API）
  - `downloadLogById()` - 下載日誌（從 IndexedDB）
  - `deleteLogById()` - 刪除日誌（IndexedDB + 伺服器）

**設定管理**：

- `data/config.json` - 日誌目錄路徑設定
  ```json
  {
    "experiment": {
      "logsDirectory": "runtime/experiment-data"
    }
  }
  ```

### 需要的修改

**實驗日誌系統已完整實作**：

1. **伺服器端 API**（`server/routes/experiment-logs.js`）
   - 列出、儲存、讀取、刪除 JSONL 檔案
   - 自動管理 `runtime/experiment-data/` 目錄

2. **前端日誌管理**（`js/experiment/experiment-log-ui.js`）
   - 透過 API 動態載入日誌列表
   - 檢視、下載、刪除功能完整
   - 統計資訊計算（手勢正確率、實驗時長等）

3. **本機儲存**（IndexedDB）
   - 實驗進行中即時儲存
   - 離線可用
   - 與伺服器雙向同步

4. **設定管理**
   - 日誌目錄路徑可在 `config.json` 設定
   - 動態讀取，無需硬編碼

**雙備份架構**：

- 本機 IndexedDB（離線可用）
- 伺服器檔案備份（集中管理）

---

## 參考文件

### 重要代碼參考

**前端核心模組**:

- `js/core/main.js` - 初始化流程
- `js/sync/sync-client.js` - 同步客戶端
- `js/sync/sync-manager-ui.js` - 同步 UI
- `js/core/experiment-hub-client.js` - 實驗 Hub 客戶端
- `js/experiment/experiment-log-manager.js` - 實驗日誌管理（IndexedDB）
