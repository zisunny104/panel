# 實驗模組重構計劃

## 一、重構目標與原則

### 1.1 核心目標

- ✅ 單一檔案不超過 600 行（理想 400-500 行）
- ✅ 職責單一化：每個模組只負責一個核心功能
- ✅ 可測試性：模組間依賴清晰，易於單元測試
- ✅ 可維護性：新增功能時只需修改對應模組
- # ✅ 向後相容：保持現有 API 介面不變

## 二、現有架構分析

### 2.1 目前檔案結構與問題

| 檔案名稱                      | 行數 | 主要職責           | 問題分析                            | 改進狀態                           |
| ----------------------------- | ---- | ------------------ | ----------------------------------- | ---------------------------------- |
| `panel-experiment-manager.js` | 593  | 主管理器、協調者   | ✅ 規模適中，但職責過多             | ⏳ 待拆分                          |
| `panel-experiment-flow.js`    | 1137 | 流程控制、步驟切換 | ⚠️ 超過千行，包含太多輔助功能       | ✅ startNextUnit 已修復            |
| `panel-experiment-units.js`   | 921  | 單元選擇、組合管理 | ❌ 包含拖曳排序、組合選擇等多種功能 | ⏳ 待拆分                          |
| `panel-experiment-ui.js`      | 712  | UI 更新、事件監聽  | ⚠️ 職責較單一，但仍可優化           | ⏳ 待優化                          |
| `panel-experiment-sync.js`    | 518  | 遠端同步           | ✅ 職責單一，規模適中               | ✅ 無需改進                        |
| `panel-experiment-timer.js`   | 119  | 計時器             | ✅ 完美                             | ✅ 無需改進                        |
| `panel-experiment-media.js`   | 349  | 媒體播放           | ✅ 職責單一                         | ✅ 無需改進                        |
| `panel-experiment-power.js`   | 412  | 電源控制           | ✅ 職責單一                         | ✅ 無需改進                        |
| `panel-button-manager.js`     | 1289 | 按鈕事件、判定邏輯 | ⚠️ 超過千行，混雜判定與觸發邏輯     | ✅ clearAllButtonHighlights 已新增 |
| `panel-ui-controls.js`        | 769  | UI 控制項管理      | ⚠️ 預設值硬編碼                     | ✅ DEFAULTS 常數化完成             |
| `action-manager.js`           | 425  | 動作序列管理       | ✅ 職責單一                         | ✅ 無需改進                        |
| `combination-selector.js`     | ~300 | 組合選擇邏輯       | ✅ 職責專注，但可整合至新模組       | ⏳ 待整合                          |
| `experiment-hub-client.js`    | ~400 | 中樞通訊客戶端     | ✅ 職責單一，可整合至hub管理器      | ⏳ 待整合                          |
| `experiment-state-manager.js` | ~450 | 狀態持久化管理     | ✅ 職責單一，可整合至狀態管理       | ⏳ 待整合                          |
| `board-state-manager.js`      | ~350 | 板端狀態管理       | ✅ 職責單一，可整合至狀態管理       | ⏳ 待整合                          |
| `board-log-manager.js`        | ~550 | 板端日誌管理       | ✅ 職責單一，可整合至日誌管理       | ⏳ 待整合                          |
| `board-log-ui.js`             | ~500 | 日誌UI介面         | ✅ 職責單一，可整合至UI管理         | ⏳ 待整合                          |

### 2.2 關鍵函式分布

#### panel-experiment-flow.js (1048行) - 需要拆分

```
核心流程函式：
- startExperiment()          - 開始實驗
- stopExperiment()           - 停止實驗
- pauseExperiment()          - 暫停實驗
- resumeExperiment()         - 恢復實驗
- nextStep()                 - 下一步
- executeStep()              - 執行步驟
- startNextUnit()            - 開始下一單元

輔助函式（應移出）：
- generateNewExperimentIdWithHub()  → 移至 hub-manager
- smartRegenerateExperimentId()     → 移至 hub-manager
- handleStepTransition()            → 移至 action-handler
- handleAutoProgression()           → 移至 action-handler
- handleKeyboardInteraction()       → 移至 action-handler
- preloadNextStepMedia()            → 移至 media-manager
- showCurrentStepMedia()            → 移至 media-manager
- showCurrentStepMediaOrHome()      → 移至 media-manager
```

#### panel-experiment-units.js (921行) - 需要拆分

```
核心單元管理函式：
- getSelectedUnits()         - 取得選中單元
- findUnitById()            - 根據ID查找單元
- startFirstUnit()          - 開始第一單元
- loadSelectedUnits()       - 載入選中單元

組合管理函式（應獨立）：
- handleCombinationSelection()      → 移至 combination-manager
- reapplyRandomCombination()        → 移至 combination-manager
- selectDefaultCombination()        → 移至 combination-manager
- applyDefaultSequence()            → 移至 combination-manager
- applyUnitCombination()            → 移至 combination-manager
- autoReapplyRandomCombination()    → 移至 combination-manager

UI渲染函式（應獨立）：
- renderUnitList()                  → 移至 ui-manager
- createUnitListItem()              → 移至 ui-manager
- addStartupCard()                  → 移至 ui-manager
- addShutdownCard()                 → 移至 ui-manager
- enableUnitDragSort()              → 移至 ui-manager
- updateUnitButtonStates()          → 移至 ui-manager
```

#### panel-button-manager.js (1148行) - 需要拆分

```
事件處理函式：
- simulateButtonClick()      - 模擬按鈕點擊
- setupEventListeners()      - 設置事件監聽
- setupMouseEvents()         - 滑鼠事件
- setupTouchEvents()         - 觸控事件
- setupKeyboardEvents()      - 鍵盤事件

判定邏輯函式（應獨立）：
- handleButtonPressed()             → 移至 action-handler
- checkActionConditions()           → 移至 action-handler
- executeButtonFunction()           → 移至 action-handler

實驗相關函式（應獨立）：
- updateExperimentButtonStyles()    → 移至 ui-manager
- updateMediaForCurrentAction()     → 移至 media-manager
- clearButtonFunctions()            → 保留但簡化
```

#### combination-selector.js (~300行) - 可整合

```
組合選擇函式：
- selectCombination()               - 選擇組合
- getCombinationUnitIds()           - 取得組合單元ID
- checkAndApplyDefaultCombination() - 檢查並套用預設組合
- getAvailableCombinations()        - 取得可用組合
- validateCombination()             - 驗證組合有效性
```

#### experiment-hub-client.js (~400行) - 可整合

```
中樞通訊函式：
- constructor()                     - 初始化客戶端
- connect()                         - 連接到中樞
- disconnect()                      - 斷開連接
- sendMessage()                     - 發送訊息
- onMessage()                       - 訊息處理
- queryExperimentId()               - 查詢實驗ID
- registerExperimentId()            - 註冊實驗ID
- syncState()                       - 同步狀態
```

#### experiment-state-manager.js (~450行) - 可整合

```
狀態管理函式：
- constructor()                     - 初始化狀態管理器
- setupSync()                       - 設置同步
- setupInputSync()                  - 設置輸入同步
- setupHubSync()                    - 設置中樞同步
- applyHubState()                   - 套用中樞狀態
- setExperimentId()                 - 設置實驗ID
- getExperimentId()                 - 取得實驗ID
- syncExperimentIdWithInput()       - 與輸入同步實驗ID
- getInputExperimentId()            - 取得輸入實驗ID
- setParticipantName()              - 設置受試者名稱
- getParticipantName()              - 取得受試者名稱
- setCurrentCombination()           - 設置目前組合
- startExperiment()                 - 開始實驗
- stopExperiment()                   - 停止實驗
- pauseExperiment()                 - 暫停實驗
- resumeExperiment()                - 恢復實驗
- generateNewExperimentId()         - 生成新實驗ID
- getCurrentState()                 - 取得目前狀態
- on()                              - 事件監聽
- off()                             - 取消事件監聽
```

#### board-state-manager.js (~350行) - 可整合

```
板端狀態管理函式：
- constructor()                     - 初始化
- async startExperiment()           - 開始實驗
- pauseExperiment()                 - 暫停實驗
- resumeExperiment()                 - 恢復實驗
- async stopExperiment()            - 停止實驗
- toggleExperiment()                - 切換實驗狀態
- startTimer()                      - 開始計時器
- stopTimer()                       - 停止計時器
- updateTimerDisplay()              - 更新計時器顯示
- formatDuration()                  - 格式化持續時間
- broadcastExperimentState()        - 廣播實驗狀態
- resetExperimentState()            - 重置實驗狀態
- onSyncConnected()                 - 同步連接處理
- onSyncDisconnected()              - 同步斷開處理
- handleRemoteExperimentStarted()   - 處理遠端開始
- handleRemoteExperimentPaused()    - 處理遠端暫停
- handleRemoteExperimentResumed()   - 處理遠端恢復
- handleRemoteExperimentStopped()   - 處理遠端停止
```

#### board-log-manager.js (~550行) - 可整合

```
日誌管理函式：
- constructor()                     - 初始化
- _setupExperimentIdSync()          - 設置實驗ID同步
- getExperimentId()                 - 取得實驗ID
- async clearLocalCache()           - 清除本地快取
- setExperimentId()                 - 設置實驗ID
- initialize()                      - 初始化
- _getCurrentExperimentId()         - 取得目前實驗ID
- _getTimestamp()                   - 取得時間戳
- _autoStartExperimentIfNeeded()    - 自動開始實驗
- logExperimentStart()              - 記錄實驗開始
- logExperimentEnd()                - 記錄實驗結束
- logExperimentPause()              - 記錄實驗暫停
- logExperimentResume()             - 記錄實驗恢復
- logGestureStepStart()             - 記錄手勢步驟開始
- logGestureStepEnd()               - 記錄手勢步驟結束
- logGestureAttempt()               - 記錄手勢嘗試
```

#### board-log-ui.js (~500行) - 可整合

```
日誌UI函式：
- constructor()                     - 初始化
- initialize()                      - 初始化UI
- async downloadExperimentLog()     - 下載實驗日誌
- async loadExperimentLogs()        - 載入實驗日誌
- async getLogsDirectory()          - 取得日誌目錄
- async loadExperimentLogsFromDirectory() - 從目錄載入日誌
- async listFilesInDirectory()      - 列出目錄檔案
- _getApiUrl()                      - 取得API URL
- _getApiBasePath()                 - 取得API基礎路徑
- parseJSONL()                      - 解析JSONL
- displayExperimentLogs()           - 顯示實驗日誌
- formatFileSize()                  - 格式化檔案大小
- formatDate()                      - 格式化日期
- toggleLogSelection()              - 切換日誌選擇
- updateDeleteButton()              - 更新刪除按鈕
- async viewLogDetails()            - 查看日誌詳情
```

---

## 三、新架構設計

### 3.1 模組架構圖

```
┌─────────────────────────────────────────────────────────────┐
│                   experiment/ (實驗管理目錄)                │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
    ┌──────────┴──────────┐         ┌──────────┴──────────┐
    │  hub-manager.js     │◄───────►│  data-service.js    │
    │ (中樞/同步/模式判斷)  │         │ (JSONL紀錄/論文數據) │
    └──────────┬──────────┘         └──────────┬──────────┘
               │                               │
               ▼                               ▼
    ┌─────────────────────────────────────────────────────────┐
    │              experiment-flow-manager.js                 │
    │        (核心流程控制：Step / Index / 生命周期)            │
    └──────┬───────────────┬───────────────────────┬──────────┘
           │               │                       │
           ▼               ▼                       ▼
┌──────────────────┐┌──────────────────┐┌──────────────────┐
│ combination-     ││  action-handler.js││  state-manager.js │
│ manager.js       ││ (動作/手勢判定中心)││ (狀態同步/計時器) │
│ (場景/單元/排序)  ││                  ││                  │
└──────────────────┘└──────────────────┘└──────────────────┘
           │                       │
           ▼                       ▼
┌──────────────────┐         ┌──────────────────┐
│   ui-manager.js  │         │  log-manager.js  │
│ (高亮/標籤/按鈕樣式)│         │ (日誌記錄/UI介面)│
└──────────────────┘         └──────────────────┘
           │
           ▼
┌──────────────────┐
│ ui-components.js │
│ (可重用UI元件系統)│
└──────────────────┘
```

### 3.2 新模組規劃

#### 模組1：experiment-hub-manager.js (預估 400行)

**職責**: 實驗ID管理、同步模式判定、中樞通訊

**來源函式**:

```javascript
// 從 panel-experiment-manager.js
-registerExperimentId() -
  getCurrentExperimentId() -
  updateExperimentIdDisplay() -
  initializeFromSync() -
  getHubState() -
  // 從 panel-experiment-flow.js
  generateNewExperimentIdWithHub() -
  smartRegenerateExperimentId() -
  // 從 experiment-hub-client.js (整合)
  connect() -
  disconnect() -
  sendMessage() -
  onMessage() -
  queryExperimentId() -
  registerExperimentId() -
  syncState() -
  // 既有函式
  isInSyncMode() -
  queryExperimentId();
```

**新增函式**:

```javascript
class ExperimentHubManager {
  constructor(config) {
    this.currentExperimentId = null;
    this.sessionId = null;
    this.isOperatorMode = false;
  }

  // ID 管理
  async generateExperimentId(source = 'auto')
  setExperimentId(id, source)
  getExperimentId()
  validateExperimentId(id)

  // 同步模式
  isInSyncMode()
  setOperatorMode(isOperator)
  getDeviceRole()

  // Hub 通訊
  async registerToHub(sessionId)
  async queryHubState(sessionId)
  async syncIdToHub(experimentId)

  // 事件通知
  broadcastIdChanged(experimentId)
  handleRemoteIdUpdate(data)
}
```

---

#### 模組2：experiment-combination-manager.js (預估 400行)

**職責**: 實驗組合選擇、單元排序、隨機化

**來源函式**:

```javascript
// 從 panel-experiment-units.js
-handleCombinationSelection() -
  reapplyRandomCombination() -
  selectDefaultCombination() -
  applyDefaultSequence() -
  applyUnitCombination() -
  autoReapplyRandomCombination() -
  renderDefaultSequences() -
  // 從 combination-selector.js (整合)
  selectCombination() -
  getCombinationUnitIds() -
  checkAndApplyDefaultCombination() -
  getAvailableCombinations() -
  validateCombination() -
  // 從 random-utils.js (既有)
  createSeededRandom() -
  shuffleArray();
```

**新增函式**:

```javascript
class ExperimentCombinationManager {
  constructor(dataService) {
    this.dataService = dataService;
    this.currentCombination = null;
    this.availableCombinations = [];
    this.randomSeed = null;
  }

  // 組合選擇
  async loadCombinations()
  selectCombination(combinationId)
  getCurrentCombination()
  getCombinationUnits(combinationId)

  // 隨機化
  createSeededRandom(seed)
  shuffleUnits(units, seed)
  generateRandomSeed()

  // 預設處理
  applyDefaultCombination()
  checkForDefaultCombination()

  // 狀態同步
  broadcastCombinationSelected(combination)
  handleRemoteCombinationUpdate(data)
}
```

---

#### 模組3：experiment-flow-manager.js (預估 450行)

**職責**: 實驗生命週期管理、步驟流程控制

**來源函式**:

```javascript
// 從 panel-experiment-flow.js (保留核心流程)
-startExperiment() -
  stopExperiment() -
  pauseExperiment() -
  resumeExperiment() -
  nextStep() -
  previousStep() -
  executeStep() -
  startNextUnit() -
  handleUnitCompletion() -
  handleExperimentEnd() -
  finishExperiment() -
  finalizeExperiment() -
  // 從 panel-experiment-manager.js
  loadUnitsAndStart() -
  showExperimentWaitingState();
```

**新增/重構函式**:

```javascript
class ExperimentFlowManager {
  constructor(options) {
    this.isRunning = false;
    this.isPaused = false;
    this.currentUnitIndex = 0;
    this.currentStepIndex = 0;
    this.loadedUnits = [];

    // 依賴注入
    this.hubManager = options.hubManager;
    this.actionHandler = options.actionHandler;
    this.uiManager = options.uiManager;
    this.dataService = options.dataService;
  }

  // 生命週期
  async initializeExperiment(units, experimentId)
  async startExperiment()
  pauseExperiment()
  resumeExperiment()
  async stopExperiment(reason = 'manual')
  async finalizeExperiment()

  // 步驟流程
  async executeCurrentStep()
  async nextStep()
  async previousStep()
  canProgressToNextStep()

  // 單元流程
  async startUnit(unitIndex)
  async completeCurrentUnit()
  hasNextUnit()

  // 狀態查詢
  getExperimentState()
  getCurrentStep()
  getCurrentUnit()
  getProgress()

  // 事件發布
  emitStateChanged(state)
  emitStepChanged(step)
  emitUnitChanged(unit)
}
```

---

#### 模組4：experiment-action-handler.js (預估 400行)

**職責**: 按鈕動作判定、手勢識別、條件驗證

**來源函式**:

```javascript
// 從 panel-button-manager.js
-handleButtonPressed()(邏輯部分) -
  checkActionConditions() -
  executeButtonFunction() -
  // 從 panel-experiment-flow.js
  handleStepTransition() -
  handleAutoProgression() -
  handleKeyboardInteraction() -
  checkAutoProgressionForEmptyInteractions() -
  // 從 action-manager.js (整合)
  completeActionById() -
  validateAction() -
  handleRemoteActionCompleted();
```

**新增函式**:

```javascript
class ExperimentActionHandler {
  constructor(flowManager) {
    this.flowManager = flowManager;
    this.pendingActions = new Map();
    this.completedActions = new Set();
  }

  // 動作判定
  async handleButtonAction(buttonId, functionName)
  validateActionConditions(action)
  canExecuteAction(actionId)

  // 手勢處理
  handleGestureInput(gesture)
  validateGesture(gesture, expectedGesture)

  // 步驟轉換
  async processStepTransition(interaction)
  checkTransitionConditions(fromStep, toStep)

  // 自動推進
  async checkAutoProgression(step)
  shouldAutoProgress(step)

  // 遠端同步
  broadcastActionCompleted(actionId)
  handleRemoteAction(data)

  // 錯誤處理
  handleActionError(action, error)
  retryAction(actionId)
}
```

---

#### 模組5：experiment-state-manager.js (預估 500行)

**職責**: 統一的實驗狀態管理、跨裝置同步

**來源函式**:

```javascript
// 從 experiment-state-manager.js (整合)
  constructor() -
  setupSync() -
  setupInputSync() -
  setupHubSync() -
  applyHubState() -
  setExperimentId() -
  getExperimentId() -
  syncExperimentIdWithInput() -
  getInputExperimentId() -
  setParticipantName() -
  getParticipantName() -
  setCurrentCombination() -
  startExperiment() -
  stopExperiment() -
  pauseExperiment() -
  resumeExperiment() -
  generateNewExperimentId() -
  getCurrentState() -
  on() -
  off() -
// 從 board-state-manager.js (整合)
  async startExperiment() -
  pauseExperiment() -
  resumeExperiment() -
  async stopExperiment() -
  toggleExperiment() -
  startTimer() -
  stopTimer() -
  updateTimerDisplay() -
  formatDuration() -
  broadcastExperimentState() -
  resetExperimentState() -
  onSyncConnected() -
  onSyncDisconnected() -
  handleRemoteExperimentStarted() -
  handleRemoteExperimentPaused() -
  handleRemoteExperimentResumed() -
  handleRemoteExperimentStopped();
```

**新增函式**:

```javascript
class ExperimentStateManager {
  constructor(options) {
    this.hubManager = options.hubManager;
    this.currentState = 'idle';
    this.experimentId = null;
    this.participantName = null;
    this.timer = { startTime: null, elapsed: 0 };
  }

  // 狀態管理
  setState(newState, source = 'local')
  getState()
  isState(state)

  // 實驗控制
  async startExperiment()
  async stopExperiment()
  pauseExperiment()
  resumeExperiment()

  // 計時器管理
  startTimer()
  stopTimer()
  getElapsedTime()
  formatDuration(ms)

  // 同步處理
  handleRemoteStateUpdate(data)
  broadcastStateChange(state)
  syncWithHub()

  // 事件系統
  onStateChanged(callback)
  offStateChanged(callback)
}
```

---

#### 模組6：experiment-log-manager.js (預估 600行)

**職責**: 統一的實驗日誌管理、資料記錄與檢索

**來源函式**:

```javascript
// 從 board-log-manager.js (整合)
  constructor() -
  _setupExperimentIdSync() -
  getExperimentId() -
  async clearLocalCache() -
  setExperimentId() -
  initialize() -
  _getCurrentExperimentId() -
  _getTimestamp() -
  _autoStartExperimentIfNeeded() -
  logExperimentStart() -
  logExperimentEnd() -
  logExperimentPause() -
  logExperimentResume() -
  logGestureStepStart() -
  logGestureStepEnd() -
  logGestureAttempt() -
// 從 board-log-ui.js (整合)
  async downloadExperimentLog() -
  async loadExperimentLogs() -
  async getLogsDirectory() -
  async loadExperimentLogsFromDirectory() -
  async listFilesInDirectory() -
  _getApiUrl() -
  _getApiBasePath() -
  parseJSONL() -
  displayExperimentLogs() -
  formatFileSize() -
  formatDate() -
  toggleLogSelection() -
  updateDeleteButton() -
  async viewLogDetails();
```

**新增函式**:

```javascript
class ExperimentLogManager {
  constructor(options) {
    this.stateManager = options.stateManager;
    this.dataService = options.dataService;
    this.logs = [];
    this.currentExperimentId = null;
  }

  // 日誌記錄
  async logEvent(eventType, data)
  logExperimentLifecycle(event, details)
  logGestureEvent(gestureIndex, stepId, attemptData)
  logSystemEvent(event, data)

  // 資料管理
  async saveLogEntry(entry)
  async loadExperimentLogs(experimentId)
  async exportLogs(format = 'jsonl')

  // UI 介面
  displayLogs(logs)
  filterLogs(criteria)
  searchLogs(query)

  // 檔案操作
  async downloadLogs(experimentId)
  async deleteLogs(experimentIds)

  // 同步處理
  handleRemoteLogUpdate(data)
  syncLogsWithHub()
}
```

---

#### 模組8：experiment-ui-components.js (預估 500行)

**職責**: 可重用的UI元件系統，在不同頁面間共享相同介面

**重複UI元件分析**:

```html
<!-- 發現的重複元件 -->
<!-- 單元組合選擇器 (index.html + board.html) -->
<div class="combination-selector-section">
  <h3>單元組合</h3>
  <ul class="experiment-default-list" id="combinationSelector"></ul>
</div>

<!-- 教學單元選擇器 (index.html + board.html) -->
<div class="experiment-panel-units">
  <div class="units-header">
    <span>實驗單元</span>
    <label class="select-all-checkbox">
      <input type="checkbox" id="selectAllUnits" checked />
      <span>全選</span>
    </label>
  </div>
  <div class="units-list-container">
    <ul class="experiment-units-list"></ul>
  </div>
</div>

<!-- 實驗控制面板 (index.html + board.html) -->
<div class="experiment-control-group">
  <div class="experiment-control-header">
    <label>實驗控制</label>
    <div id="experimentTimer" class="experiment-timer">00:00.000</div>
  </div>
  <div id="experimentIdRow" class="experiment-start-row">
    <button id="startExperimentBtn" class="experiment-start-btn btn-success">
      ▶ 開始實驗
    </button>
  </div>
  <div id="experimentControlButtons" class="experiment-control-buttons">
    <button id="pauseExperimentBtn" class="experiment-pause-btn btn-primary">
      ⏸ 暫停
    </button>
    <button id="stopExperimentBtn" class="experiment-stop-btn btn-danger">
      ⏹ 停止
    </button>
  </div>
</div>

<!-- 實驗ID輸入組件 (index.html + board.html) -->
<div class="experiment-id-group">
  <input type="text" id="experimentIdInput" class="form-input" maxlength="10" />
  <button id="regenerateIdButton" class="btn-secondary">
    <svg>...</svg>
  </button>
</div>
```

**元件化設計**:

```javascript
class ExperimentUIComponents {
  constructor(options) {
    this.container = options.container;
    this.eventBus = options.eventBus;
  }

  // 單元組合選擇器元件
  createCombinationSelector(containerId) {
    const html = `
      <div class="combination-selector-section">
        <h3>單元組合</h3>
        <ul class="experiment-default-list" id="${containerId}-selector">
        </ul>
      </div>
    `;
    return this.createComponent(html, `${containerId}-combination-selector`);
  }

  // 教學單元選擇器元件
  createUnitSelector(containerId, options = {}) {
    const { showSelectAll = true, allowDragSort = false } = options;
    const selectAllHtml = showSelectAll
      ? `
      <label class="select-all-checkbox">
        <input type="checkbox" id="${containerId}-selectAll" checked>
        <span>全選</span>
      </label>
    `
      : "";

    const html = `
      <div class="experiment-panel-units">
        <div class="units-header">
          <span>實驗單元</span>
          ${selectAllHtml}
        </div>
        <div class="units-list-container">
          <ul class="experiment-units-list" id="${containerId}-list">
          </ul>
        </div>
      </div>
    `;
    return this.createComponent(html, `${containerId}-unit-selector`);
  }

  // 實驗控制面板元件
  createExperimentControls(containerId) {
    const html = `
      <div class="experiment-control-group">
        <div class="experiment-control-header">
          <label>實驗控制</label>
          <div id="${containerId}-timer" class="experiment-timer">00:00.000</div>
        </div>
        <div id="${containerId}-startRow" class="experiment-start-row">
          <button id="${containerId}-startBtn" class="experiment-start-btn btn-success">
            ▶ 開始實驗
          </button>
        </div>
        <div id="${containerId}-controlButtons" class="experiment-control-buttons">
          <button id="${containerId}-pauseBtn" class="experiment-pause-btn btn-primary">
            ⏸ 暫停
          </button>
          <button id="${containerId}-stopBtn" class="experiment-stop-btn btn-danger">
            ⏹ 停止
          </button>
        </div>
      </div>
    `;
    return this.createComponent(html, `${containerId}-experiment-controls`);
  }

  // 實驗ID輸入元件
  createExperimentIdInput(containerId) {
    const html = `
      <div class="experiment-id-group">
        <input type="text" id="${containerId}-input" class="form-input" maxlength="10" placeholder="載入中...">
        <button id="${containerId}-regenerateBtn" class="btn-secondary" title="重新產生實驗ID">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="icon-sm">
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
            <path d="M21 3v5h-5"></path>
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
            <path d="M3 21v-5h5"></path>
          </svg>
        </button>
      </div>
    `;
    return this.createComponent(html, `${containerId}-experiment-id`);
  }

  // 通用元件建立方法
  createComponent(html, componentId) {
    const wrapper = document.createElement("div");
    wrapper.id = componentId;
    wrapper.innerHTML = html;
    return wrapper;
  }

  // 元件事件綁定
  bindComponentEvents(component, eventHandlers) {
    Object.entries(eventHandlers).forEach(([selector, handler]) => {
      const element = component.querySelector(selector);
      if (element) {
        element.addEventListener("click", handler);
      }
    });
  }

  // 元件狀態更新
  updateComponentState(componentId, state) {
    const component = document.getElementById(componentId);
    if (!component) return;

    // 根據狀態更新元件外觀和行為
    this.applyStateToComponent(component, state);
  }

  // 套用狀態到元件
  applyStateToComponent(component, state) {
    // 實現狀態套用邏輯
    if (state.disabled) {
      component.classList.add("disabled");
    } else {
      component.classList.remove("disabled");
    }

    if (state.hidden) {
      component.style.display = "none";
    } else {
      component.style.display = "";
    }
  }
}
```

**使用範例**:

```javascript
// 在不同頁面中使用相同元件
const uiComponents = new ExperimentUIComponents({
  container: document.body,
  eventBus: window.eventBus,
});

// 在 index.html 中使用
const unitSelector = uiComponents.createUnitSelector("panel-units", {
  showSelectAll: true,
  allowDragSort: true,
});
document.getElementById("experimentPanel").appendChild(unitSelector);

// 在 board.html 中使用
const boardUnitSelector = uiComponents.createUnitSelector("board-units", {
  showSelectAll: true,
  allowDragSort: false,
});
document.querySelector(".left-panel").appendChild(boardUnitSelector);
```

**職責**: UI 渲染、高亮更新、視覺反饋

**來源函式**:

```javascript
// 從 panel-experiment-ui.js (保留)
-updateExperimentUI() -
  updateButtonStates() -
  updateHighlightVisibility() -
  clearAllHighlights() -
  lockUnitList() -
  lockExperimentId() -
  // 從 panel-experiment-units.js
  renderUnitList() -
  createUnitListItem() -
  addStartupCard() -
  addShutdownCard() -
  enableUnitDragSort() -
  updateUnitButtonStates() -
  updateSelectAllState() -
  // 從 panel-button-manager.js
  updateExperimentButtonStyles() -
  clearButtonFunctions()(UI部分) -
  // 從 panel-experiment-flow.js
  updateExperimentUI() -
  updateTimerDisplay();
```

**新增/重構函式**:

```javascript
class ExperimentUIManager {
  constructor(elements) {
    this.elements = elements; // DOM元素快取
    this.cachedElements = new Map();
  }

  // 主UI更新
  updateExperimentState(state)
  updateStepDisplay(step)
  updateUnitProgress(current, total)

  // 按鈕高亮
  updateButtonHighlights(actions)
  highlightButton(buttonId, highlight = true)
  clearAllHighlights()

  // 按鈕樣式
  updateButtonLabels(buttons)
  updateButtonStyles(experimentRunning)
  setButtonEnabled(buttonId, enabled)

  // 單元列表
  renderUnitList(units)
  createUnitItem(unit)
  updateUnitStatus(unitId, status)
  enableDragSort(container)

  // 計時器
  updateTimerDisplay(elapsed)
  startTimerAnimation()
  stopTimerAnimation()

  // 鎖定控制
  lockUI(lock, reason)
  lockUnitSelection(lock)
  lockExperimentIdInput(lock)

  // 視覺反饋
  showSuccessAnimation(element)
  showErrorAnimation(element)
  showLoadingState(show)
}
```

---

#### 模組6：experiment-data-service.js (預估 300行)

**職責**: JSONL 日誌記錄、實驗數據匯出、伺服器通訊

**來源函式**:

```javascript
// 從 panel-logger.js
-logActionComplete() -
  formatExperimentData() -
  saveToIndexedDB() -
  // 從 board-log-manager.js (實驗頁面)
  saveLogToServer() -
  downloadLocalJsonl() -
  exportExperimentData() -
  // 新增功能
  統一的數據格式化 -
  離線數據暫存 -
  自動上傳機制;
```

**新增函式**:

```javascript
class ExperimentDataService {
  constructor(config) {
    this.config = config;
    this.logBuffer = [];
    this.autoSaveInterval = null;
  }

  // 日誌記錄
  logAction(actionData)
  logStepCompletion(stepData)
  logUnitCompletion(unitData)
  logExperimentCompletion(experimentData)

  // 數據格式化
  formatActionLog(action)
  formatExperimentSummary(experiment)
  generateJsonlLine(data)

  // 本地儲存
  async saveToIndexedDB(data)
  async loadFromIndexedDB(experimentId)
  clearLocalData(experimentId)

  // 伺服器同步
  async uploadToServer(data)
  async downloadExperimentData(experimentId)
  enableAutoSync(interval = 5000)
  disableAutoSync()

  // 匯出功能
  exportAsJsonl(data)
  exportAsCsv(data)
  downloadFile(content, filename)

  // 查詢功能
  async queryExperimentLogs(experimentId)
  async queryActionHistory(experimentId, buttonId)
  getExperimentStatistics(experimentId)
}
```

---

## 五、函式對照表

### 5.1 詳細搬遷對照

| 原檔案                                                            | 原函式名稱                               | 目標檔案                          | 新函式名稱               | 優先級 |
| ----------------------------------------------------------------- | ---------------------------------------- | --------------------------------- | ------------------------ | ------ |
| **panel-experiment-flow.js → experiment-flow-manager.js**         |                                          |                                   |                          |
| panel-experiment-flow.js                                          | startExperiment                          | experiment-flow-manager.js        | startExperiment          | P0     |
| panel-experiment-flow.js                                          | stopExperiment                           | experiment-flow-manager.js        | stopExperiment           | P0     |
| panel-experiment-flow.js                                          | pauseExperiment                          | experiment-flow-manager.js        | pauseExperiment          | P0     |
| panel-experiment-flow.js                                          | resumeExperiment                         | experiment-flow-manager.js        | resumeExperiment         | P0     |
| panel-experiment-flow.js                                          | nextStep                                 | experiment-flow-manager.js        | nextStep                 | P0     |
| panel-experiment-flow.js                                          | executeStep                              | experiment-flow-manager.js        | executeStep              | P0     |
| panel-experiment-flow.js                                          | startNextUnit                            | experiment-flow-manager.js        | startNextUnit            | P0     |
| **panel-experiment-flow.js → experiment-hub-manager.js**          |                                          |                                   |                          |
| panel-experiment-flow.js                                          | generateNewExperimentIdWithHub           | experiment-hub-manager.js         | generateExperimentId     | P1     |
| panel-experiment-flow.js                                          | smartRegenerateExperimentId              | experiment-hub-manager.js         | regenerateExperimentId   | P1     |
| **panel-experiment-flow.js → experiment-action-handler.js**       |                                          |                                   |                          |
| panel-experiment-flow.js                                          | handleStepTransition                     | experiment-action-handler.js      | processStepTransition    | P1     |
| panel-experiment-flow.js                                          | handleAutoProgression                    | experiment-action-handler.js      | checkAutoProgression     | P1     |
| panel-experiment-flow.js                                          | handleKeyboardInteraction                | experiment-action-handler.js      | handleKeyboardAction     | P2     |
| panel-experiment-flow.js                                          | checkAutoProgressionForEmptyInteractions | experiment-action-handler.js      | shouldAutoProgress       | P2     |
| **panel-experiment-flow.js → experiment-ui-manager.js**           |                                          |                                   |                          |
| panel-experiment-flow.js                                          | updateExperimentUI                       | experiment-ui-manager.js          | updateExperimentState    | P1     |
| panel-experiment-flow.js                                          | updateTimerDisplay                       | experiment-ui-manager.js          | updateTimerDisplay       | P2     |
| **panel-experiment-units.js → experiment-combination-manager.js** |                                          |                                   |                          |
| panel-experiment-units.js                                         | handleCombinationSelection               | experiment-combination-manager.js | selectCombination        | P0     |
| panel-experiment-units.js                                         | reapplyRandomCombination                 | experiment-combination-manager.js | reapplyRandomCombination | P1     |
| panel-experiment-units.js                                         | selectDefaultCombination                 | experiment-combination-manager.js | applyDefaultCombination  | P1     |
| panel-experiment-units.js                                         | applyDefaultSequence                     | experiment-combination-manager.js | applySequence            | P1     |
| panel-experiment-units.js                                         | applyUnitCombination                     | experiment-combination-manager.js | applyCombination         | P1     |
| panel-experiment-units.js                                         | autoReapplyRandomCombination             | experiment-combination-manager.js | autoReapply              | P2     |
| panel-experiment-units.js                                         | renderDefaultSequences                   | experiment-combination-manager.js | renderSequenceUI         | P2     |
| **panel-experiment-units.js → experiment-ui-manager.js**          |                                          |                                   |                          |
| panel-experiment-units.js                                         | renderUnitList                           | experiment-ui-manager.js          | renderUnitList           | P0     |
| panel-experiment-units.js                                         | createUnitListItem                       | experiment-ui-manager.js          | createUnitItem           | P0     |
| panel-experiment-units.js                                         | addStartupCard                           | experiment-ui-manager.js          | addStartupCard           | P1     |
| panel-experiment-units.js                                         | addShutdownCard                          | experiment-ui-manager.js          | addShutdownCard          | P1     |
| panel-experiment-units.js                                         | enableUnitDragSort                       | experiment-ui-manager.js          | enableDragSort           | P1     |
| panel-experiment-units.js                                         | updateUnitButtonStates                   | experiment-ui-manager.js          | updateUnitStatus         | P1     |
| panel-experiment-units.js                                         | updateSelectAllState                     | experiment-ui-manager.js          | updateSelectAllCheckbox  | P2     |
| **panel-button-manager.js → experiment-action-handler.js**        |                                          |                                   |                          |
| panel-button-manager.js                                           | handleButtonPressed                      | experiment-action-handler.js      | handleButtonAction       | P0     |
| panel-button-manager.js                                           | checkActionConditions                    | experiment-action-handler.js      | validateActionConditions | P0     |
| panel-button-manager.js                                           | executeButtonFunction                    | experiment-action-handler.js      | executeAction            | P1     |
| **panel-button-manager.js → experiment-ui-manager.js**            |                                          |                                   |                          |
| panel-button-manager.js                                           | updateExperimentButtonStyles             | experiment-ui-manager.js          | updateButtonStyles       | P0     |
| panel-button-manager.js                                           | clearButtonFunctions                     | experiment-ui-manager.js          | clearButtonStyles        | P2     |
| **panel-experiment-manager.js → experiment-hub-manager.js**       |                                          |                                   |                          |
| panel-experiment-manager.js                                       | registerExperimentId                     | experiment-hub-manager.js         | registerToHub            | P1     |
| panel-experiment-manager.js                                       | getCurrentExperimentId                   | experiment-hub-manager.js         | getExperimentId          | P0     |
| panel-experiment-manager.js                                       | updateExperimentIdDisplay                | experiment-hub-manager.js         | updateIdDisplay          | P2     |
| panel-experiment-manager.js                                       | initializeFromSync                       | experiment-hub-manager.js         | initializeFromHub        | P1     |
| panel-experiment-manager.js                                       | getHubState                              | experiment-hub-manager.js         | queryHubState            | P1     |
| **panel-logger.js → experiment-data-service.js**                  |                                          |                                   |                          |
| panel-logger.js                                                   | logActionComplete                        | experiment-data-service.js        | logAction                | P0     |
| panel-logger.js                                                   | formatExperimentData                     | experiment-data-service.js        | formatExperimentSummary  | P1     |
| panel-logger.js                                                   | saveToIndexedDB                          | experiment-data-service.js        | saveToIndexedDB          | P1     |
| **board-log-manager.js → experiment-data-service.js**             |                                          |                                   |                          |
| board-log-manager.js                                              | saveLogToServer                          | experiment-data-service.js        | uploadToServer           | P1     |
| board-log-manager.js                                              | downloadLocalJsonl                       | experiment-data-service.js        | exportAsJsonl            | P1     |

**優先級說明**:

- P0: 核心功能，必須優先完成
- P1: 重要功能，第二優先
- P2: 輔助功能，可延後處理

---

## 附錄

### A. 命名規範

所有新檔案和函式使用 kebab-case：

- ✅ `experiment-flow-manager.js`
- ✅ `handleButtonAction()`
- ❌ `experimentFlowManager.js`
- ❌ `HandleButtonAction()`

### B. 文檔範本

每個新模組檔案開頭必須包含：

```javascript
/**
 * ExperimentFlowManager - 實驗流程管理器
 *
 * @module experiment-flow-manager
 * @description 負責實驗的生命週期管理和步驟流程控制
 *
 * @requires experiment-hub-manager
 * @requires experiment-action-handler
 *
 * @example
 * const flowManager = new ExperimentFlowManager({
 *   hubManager: hubManager,
 *   actionHandler: actionHandler
 * });
 *
 * await flowManager.startExperiment();
 */
class ExperimentFlowManager {
  // ...
}
```

### C. Git Commit 規範

重構提交訊息格式：

```
refactor(experiment): 拆分 panel-experiment-flow 為獨立模組

- 建立 experiment-flow-manager.js (核心流程)
- 建立 experiment-action-handler.js (動作處理)
- 更新 panel-experiment-manager.js 使用新模組
- 新增單元測試

Breaking changes: 無
```

---

**文檔版本**: 2.4
**最後更新**: 2026-01-28
**維護者**: GitHub Copilot + 人類審核
