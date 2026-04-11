/**
 * ExperimentLogUI - 實驗日誌 UI 管理系統
 *
 * 負責處理實驗日誌的下載、載入、刪除等 UI 操作。
 * 使用 IndexedDB 作為資料來源。
 */

import {
  LOG_TYPES,
} from "../constants/index.js";
import { boardPageManager } from "./board-page-manager.js";
import { logFilterPanel } from "./board-log-ui-filter.js";
import { logModalPanel } from "./board-log-ui-modal.js";
import { logListPanel } from "./board-log-ui-list.js";
import { logStatsReport } from "./board-log-ui-stats.js";

class ExperimentLogUI {
  constructor({ logManager = null, timeSyncManager = null, config = null } = {}) {
    this.syncEnabled = false;
    this.currentExperiments = []; // 快取已載入的實驗列表
    this.selectedLogs = new Set(); // 用於儲存選取的日誌
    this.logManager = logManager;
    this.timeSyncManager = timeSyncManager;
    this.config = config;
    this._isLoadingList = false;
    this._lastLoadAt = 0;
    this._loadDebounceMs = 800;
    this._loadTimer = null;
    this._allExperiments = [];
    this.logCountFilter = { min: 0, max: null, maxAvailable: 0 };
    this.durationFilter = { min: 0, max: null, maxAvailable: 0 };
    this.timeFilter = {
      min: null,
      max: null,
      minAvailable: null,
      maxAvailable: null,
    };
    this._filterUiReady = false;
    this.logFilterPopover = null;
    this._logListActionsBound = false;
    this._currentLogActionsBound = false;
    this._initialized = false;

    // 初始化 BroadcastChannel 以監聽日誌更新
    this._initBroadcastChannel();
  }

  updateDependencies(deps = {}) {
    Object.assign(this, deps);
  }

  /**
   * 初始化 UI 管理器
   */
  initialize() {
    if (this._initialized) {
      return;
    }
    // 取得全域的 experimentLogManager 實例
    const logManager = this.logManager;
    const timeSyncManager = this.timeSyncManager;
    this.logManager = logManager;
    this.timeSyncManager = timeSyncManager;

    Logger.debug("[ExperimentLogUI.initialize] 開始初始化，logManager存在=" + (this.logManager ? "是" : "否") + "，timeSyncManager存在=" + (this.timeSyncManager ? "是" : "否"));

    if (!this.logManager) {
      Logger.debug("[ExperimentLogUI.initialize] experimentLogManager 尚未載入，將稍後初始化");
      return;
    }

    Logger.debug("[ExperimentLogUI.initialize] experimentLogManager 已初始化，日誌UI管理器準備就緒");

    // 初始化目前實驗日誌容器
    Logger.debug("[ExperimentLogUI.initialize] 呼叫 initializeExperimentLogContainer()");
    this.initializeExperimentLogContainer();

    Logger.debug("[ExperimentLogUI.initialize] 呼叫 initializeExperimentLogsList()");
    this.initializeExperimentLogsList();

    if (document.getElementById("experimentLogsContainer")) {
      Logger.debug("[ExperimentLogUI.initialize] experimentLogsContainer 存在，呼叫 loadExperimentLogs()");
      this.loadExperimentLogs();
    } else {
      Logger.debug("[ExperimentLogUI.initialize] experimentLogsContainer 不存在，跳過 loadExperimentLogs()");
    }

    this._initialized = true;
    Logger.debug("[ExperimentLogUI.initialize] 完成");
  }

  /**
   * 初始化目前實驗日誌容器
   */
  initializeExperimentLogContainer() {
    const container = document.getElementById("experimentLogContainer");
    if (!container) {
      Logger.debug("experimentLogContainer 元素不存在，跳過初始化");
      return;
    }
    container.className = "experiment-ui-card";
    container.innerHTML = `
      <div class="logs-header">
        <h3>實驗日誌</h3>
        <div class="logs-status">
          <button id="syncLogsNowBtn" class="is-hidden" data-action="sync-now" title="立即同步日誌" aria-label="立即同步日誌">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7,11 12,6 17,11"></polyline>
              <line x1="12" y1="6" x2="12" y2="18"></line>
            </svg>
          </button>
          <span class="status-indicator idle">等待開始</span>
        </div>
      </div>
      <div class="logs-content">
        <div class="no-current-logs">
          <div class="no-logs-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 11H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2h-4"></path>
              <path d="M9 11V9a3 3 0 0 1 6 0v2"></path>
              <circle cx="12" cy="16" r="1"></circle>
            </svg>
          </div>
          <div class="no-logs-text">尚未開始實驗</div>
          <div class="no-logs-hint">實驗開始後，此處將顯示即時日誌</div>
        </div>
      </div>
    `;

    this._bindCurrentLogActions();
  }

  /**
   * 初始化實驗日誌列表區塊
   */
  initializeExperimentLogsList() {
    const container = document.getElementById("experimentLogsList");
    if (!container) {
      Logger.debug("experimentLogsList 元素不存在，跳過初始化");
      return;
    }

    const filterBlocks = [
      this._renderFilterBlock({
        title: "記錄數",
        minValueId: "logFilterMinValue",
        maxValueId: "logFilterMaxValue",
        minRangeId: "logFilterMinRange",
        maxRangeId: "logFilterMaxRange",
        slidersId: "logFilterCountSliders",
        minValue: 0,
        maxValue: 0,
      }),
      this._renderFilterBlock({
        title: "實驗耗時",
        minValueId: "logFilterDurationMinValue",
        maxValueId: "logFilterDurationMaxValue",
        minRangeId: "logFilterDurationMinRange",
        maxRangeId: "logFilterDurationMaxRange",
        slidersId: "logFilterDurationSliders",
        minValue: "0秒",
        maxValue: "0秒",
      }),
      this._renderFilterBlock({
        title: "實驗時間",
        minValueId: "logFilterTimeMinValue",
        maxValueId: "logFilterTimeMaxValue",
        minRangeId: "logFilterTimeMinRange",
        maxRangeId: "logFilterTimeMaxRange",
        slidersId: "logFilterTimeSliders",
        minValue: "--",
        maxValue: "--",
      }),
    ].join("");

    container.innerHTML = `
      <div class="logs-section-header">
        <h2>實驗日誌列表</h2>
        <div class="logs-list-header">
          <button id="refreshLogsBtn" class="btn-secondary" data-action="refresh-logs" title="重新整理" aria-label="重新整理">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" class="icon-sm">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
              <path d="M21 3v5h-5"></path>
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
              <path d="M3 21v-5h5"></path>
            </svg>
          </button>
          <button id="logFilterToggleBtn" class="btn-secondary" data-action="toggle-filter" title="篩選記錄數" aria-label="篩選記錄數">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" class="icon-sm">
              <path d="M3 4h18"></path>
              <path d="M6 10h12"></path>
              <path d="M10 16h4"></path>
            </svg>
          </button>
          <button id="downloadSelectedLogsBtn" class="btn-secondary is-hidden" data-action="download-selected" title="下載選取" aria-label="下載選取">
            <svg class="svg-icon svg-md" viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7,10 12,15 17,10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </button>
          <button id="deleteSelectedLogsBtn" class="btn-danger is-hidden" data-action="delete-selected" title="刪除選取" aria-label="刪除選取">
            <svg class="svg-icon svg-md" viewBox="0 0 24 24">
              <polyline points="3,6 5,6 21,6"></polyline>
              <path d="M19,6v14a2,2 0 0,1-2,2H7a2,2 0 0,1-2-2V6m3,0V4a2,2 0 0,1,2-2h4a2,2 0 0,1,2,2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
      </div>

      <div id="logFilterPopover" class="log-filter-popover is-hidden" aria-hidden="true">
        ${filterBlocks}
        <div class="log-filter-actions">
          <button class="btn-secondary" data-action="reset-filter">重置</button>
          <button class="btn-primary" data-action="apply-filter">套用</button>
        </div>
      </div>

      <div class="form-group">
        <div id="experimentLogsContainer">
          <div class="logs-list-loading">載入中...</div>
        </div>
      </div>
    `;

    this._bindLogListActions();
  }

  _bindCurrentLogActions() {
    if (this._currentLogActionsBound) return;
    const container = document.getElementById("experimentLogContainer");
    if (!container) return;

    container.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;
      if (action === "sync-now") {
        this.boardPageManager?.syncLogsNow?.();
      }
    });

    this._currentLogActionsBound = true;
  }

  _bindLogListActions() {
    if (this._logListActionsBound) return;
    const container = document.getElementById("experimentLogsList");
    if (!container) return;

    container.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;
      const logId = target.dataset.logId;

      switch (action) {
        case "refresh-logs":
          this.loadExperimentLogs();
          break;
        case "toggle-filter":
          this.toggleLogFilter();
          break;
        case "download-selected":
          this.downloadSelectedLogs();
          break;
        case "delete-selected":
          this.deleteSelectedLogs();
          break;
        case "apply-filter":
          this.applyLogFilter();
          break;
        case "reset-filter":
          this.resetLogFilter();
          break;
        case "select-filtered":
          this.selectFilteredLogs();
          break;
        case "view-log":
          if (logId) this.viewLogDetails(logId);
          break;
        case "download-log":
          if (logId) this.downloadLogById(logId);
          break;
        case "delete-log":
          if (logId) this.deleteLogById(logId);
          break;
        default:
          break;
      }
    });

    container.addEventListener("change", (event) => {
      const checkbox = event.target.closest("input[data-log-id]");
      if (!checkbox) return;
      this.toggleLogSelection(checkbox.dataset.logId);
    });

    this._logListActionsBound = true;
  }

  /**
   * 下載目前實驗日誌（從 IndexedDB）
   */
  async downloadExperimentLog() {
    if (!this.logManager) {
      Logger.warn("日誌管理器未初始化");
      return;
    }

    const experimentId = document.getElementById("experimentIdInput")?.value;
    const participantName = document.getElementById(
      "participantNameInput",
    )?.value;

    if (!experimentId || !participantName) {
      Logger.warn("請先設定實驗ID和受試者名稱");
      return;
    }

    try {
      // 從 IndexedDB 取得目前實驗的日誌
      const logs = await this.logManager.getAllLogs();

      if (logs.length === 0) {
        Logger.warn("目前沒有可下載的日誌");
        return;
      }

      // 產生 JSONL 格式
      const jsonlContent = logs.map((log) => JSON.stringify(log)).join("\n");
      const blob = new Blob([jsonlContent], { type: "application/x-ndjson" });

      // 下載
      const filename = `${experimentId}_${participantName}_experiment_log.jsonl`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      Logger.info(`已下載日誌：${filename}`);
    } catch (error) {
      Logger.error("下載日誌失敗:", error);
    }
  }

  /**
   * 載入實驗日誌列表（從 runtime/experiment-data/ 資料夾）
   */
  async loadExperimentLogs() {
    Logger.debug("[ExperimentLogUI.loadExperimentLogs] 開始載入實驗日誌");
    const now = Date.now();
    if (this._isLoadingList) {
      Logger.debug("[ExperimentLogUI.loadExperimentLogs] 已在載入，略過");
      this._scheduleLogListReload();
      return;
    }
    if (now - this._lastLoadAt < this._loadDebounceMs) {
      Logger.debug("[ExperimentLogUI.loadExperimentLogs] 未達防抖時間，略過");
      this._scheduleLogListReload();
      return;
    }

    this._isLoadingList = true;

    const container = document.getElementById("experimentLogsContainer");
    if (!container) {
      Logger.warn("[ExperimentLogUI.loadExperimentLogs] experimentLogsContainer 元素不存在，無法載入日誌");
      this._isLoadingList = false;
      return;
    }

    Logger.debug("[ExperimentLogUI.loadExperimentLogs] 顯示載入狀態");

    // 顯示載入狀態
    container.innerHTML = `
      <div class="logs-loading">
        <div class="loading-spinner"></div>
        <div class="loading-text">載入實驗日誌中...</div>
      </div>
    `;

    try {
      // 從 config.json 讀取日誌目錄路徑
      const logsDir = await this.getLogsDirectory();
      const experiments = await this.loadExperimentLogsFromDirectory(logsDir);

      Logger.debug(`從檔案系統載入 ${experiments.length} 個實驗日誌`);
      // 重新載入時重置篩選條件，避免沿用上次的篩選狀態
      this.logCountFilter.min = 0;
      this.logCountFilter.max = null;
      this.durationFilter.min = 0;
      this.durationFilter.max = null;
      this.timeFilter.min = null;
      this.timeFilter.max = null;
      this.displayExperimentLogs(experiments);
    } catch (error) {
      Logger.error("載入日誌列表失敗:", error);
      this.displayExperimentLogs([]);
    } finally {
      this._isLoadingList = false;
      this._lastLoadAt = Date.now();
    }
  }

  _scheduleLogListReload() {
    if (this._loadTimer) return;
    this._loadTimer = setTimeout(() => {
      this._loadTimer = null;
      this.loadExperimentLogs();
    }, this._loadDebounceMs);
  }

  /**
   * 從 config.json 讀取日誌目錄路徑
   * @returns {Promise<string>} 日誌目錄路徑
   */
  async getLogsDirectory() {
    try {
      if (this.config?.experiment?.logsDirectory) {
        return this.config.experiment.logsDirectory;
      }
      // 如果無法從 config 讀取，使用預設值
      return "runtime/experiment-data";
    } catch {
      Logger.warn("無法從 config 讀取日誌目錄，使用預設值");
      return "runtime/experiment-data";
    }
  }

  /**
   * 從目錄載入實驗日誌
   * @param {string} dirPath - 目錄路徑
   */
  async loadExperimentLogsFromDirectory(dirPath) {
    const experiments = [];

    try {
      // 讀取目錄內容（使用相對路徑）
      const files = await this.listFilesInDirectory(dirPath);

      Logger.debug(`找到 ${files.length} 個檔案`);

      for (const filename of files) {
        if (!filename.endsWith(".jsonl")) continue;

        try {
          // 透過 API 讀取檔案內容
          const apiUrl = this._getApiUrl();
          const response = await fetch(
            `${apiUrl}/experiment-logs/read/${filename}`,
          );

          if (!response.ok) {
            Logger.debug(`無法讀取檔案: ${filename}`);
            continue;
          }

          const result = await response.json();
          if (!result.success || !result.content) {
            Logger.debug(`檔案 ${filename} 讀取失敗: ${result.error}`);
            continue;
          }

          const logs = this.parseJSONL(result.content);

          if (logs.length === 0) {
            Logger.debug(`檔案 ${filename} 無有效日誌`);
            continue;
          }

          // 從檔名解析實驗 ID（移除 _timestamp 後綴）
          const match = filename.match(/^(.+?)(?:_\d+)?\.jsonl$/);
          const experimentId = match
            ? match[1]
            : filename.replace(".jsonl", "");

          // 從日誌中找受試者名稱和實驗組合（容錯處理）
          const expStartLog = logs.find(
            (log) => log.type === LOG_TYPES.EXP_START,
          );
          const participantName = expStartLog?.participant || "n/a";
          const combinationName = expStartLog?.combo_name || "n/a";

          experiments.push({
            experimentId,
            participantName,
            combinationName,
            filename: filename,
            filePath: filename, // 只存檔案名稱，實際讀取透過 API
            logCount: logs.length,
            startTime: logs[0]?.ts || Date.now(),
            endTime: logs[logs.length - 1]?.ts || Date.now(),
            durationSeconds: Math.max(
              0,
              Math.round(
                ((logs[logs.length - 1]?.ts || 0) - (logs[0]?.ts || 0)) /
                  1000,
              ),
            ),
            logs,
            // 用於實際操作的 ID
            actualExperimentId: experimentId,
          });

          Logger.debug(`成功載入: ${filename} (${logs.length} 條記錄)`);
        } catch (error) {
          Logger.debug(`解析檔案 ${filename} 失敗:`, error.message);
          // 即使解析失敗，也嘗試顯示基本資訊
          const match = filename.match(/^(.+?)(?:_\d+)?\.jsonl$/);
          const experimentId = match
            ? match[1]
            : filename.replace(".jsonl", "");

          experiments.push({
            experimentId,
            participantName: "n/a",
            combinationName: "n/a",
            filename: filename,
            filePath: filename, // 只存檔案名稱
            logCount: 0,
            startTime: Date.now(),
            endTime: Date.now(),
            durationSeconds: 0,
            logs: [],
            actualExperimentId: experimentId,
            error: error.message,
          });
        }
      }

      // 按開始時間排序（最新的在前）
      experiments.sort((a, b) => b.startTime - a.startTime);
    } catch (error) {
      Logger.error("讀取目錄失敗:", error);
    }

    return experiments;
  }

  /**
   * 列出目錄中的檔案
   * @param {string} dirPath - 目錄路徑
   */
  async listFilesInDirectory(dirPath) {
    try {
      // 嘗試從伺服器 API 取得檔案列表
      const apiUrl = this._getApiUrl();
      const response = await fetch(`${apiUrl}/experiment-logs/list`);

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.files) {
          Logger.debug(`從 API 讀取到 ${result.files.length} 個檔案`);
          return result.files.map((f) => f.filename);
        }
      }
    } catch (error) {
      Logger.debug("API 不可用，無法動態讀取檔案列表", error.message);
    }

    // 瀏覽器無法直接列出本機目錄，必須啟動伺服器
    Logger.warn("無法讀取實驗日誌檔案。請啟動伺服器：cd server && npm start");
    return [];
  }

  /**
   * 取得 API URL（支援 Nginx 反向代理）
   * @private
   */
  _getApiUrl() {
    const protocol = window.location.protocol;
    const host = window.location.host; // 包含 hostname 和 port

    // 根據環境決定 API 路徑前綴
    const basePath = this._getApiBasePath();

    return `${protocol}//${host}${basePath}`;
  }

  /**
   * 取得 API 路徑前綴（參考 QR Code 的動態路徑邏輯，完全避免硬編碼）
   * @private
   */
  _getApiBasePath() {
    // 根據頁面路徑動態決定 API 前綴（完全動態，無硬編碼）
    const pathname = window.location.pathname;

    // 取得頁面所在的目錄路徑
    let basePath = pathname;
    if (!basePath.endsWith("/")) {
      // 如果包含檔名，移除檔名部分
      basePath = basePath.substring(0, basePath.lastIndexOf("/") + 1);
    }

    // 確保以 / 結尾
    if (!basePath.endsWith("/")) {
      basePath += "/";
    }

    // API 永遠在頁面所在目錄的 api 子目錄
    // 讓 Nginx 處理實際的路徑映射
    return basePath + "api";
  }

  /**
   * 解析 JSONL 格式
   */
  parseJSONL(content) {
    return content
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (e) {
          Logger.warn("無法解析行:", line);
          return null;
        }
      })
      .filter((log) => log !== null);
  }


  /**
   * 檢視日誌詳細資訊（從檔案）
   * @param {string} logId - 日誌ID（實驗ID）
   */
  async viewLogDetails(logId) {
    try {
      Logger.debug(`正在查看實驗日誌: ${logId}`);

      // 從已載入的列表中找到對應的實驗（優先用 filename 比對，對應按鈕傳入的唯一檔名）
      const experiment = this.currentExperiments.find(
        (exp) =>
          exp.filename === logId ||
          exp.actualExperimentId === logId ||
          exp.experimentId === logId,
      );

      if (!experiment || !experiment.logs || experiment.logs.length === 0) {
        Logger.warn(
          `找不到實驗 ${logId} 的日誌資料，currentExperiments 長度: ${this.currentExperiments.length}`,
        );
        return;
      }

      const entries = experiment.logs;
      Logger.debug(`找到 ${entries.length} 條日誌記錄`);

      // 計算統計資訊
      const stats = this.calculateLogStatistics(entries);

      // 產生 JSONL 內容
      const jsonlContent = entries.map((e) => JSON.stringify(e)).join("\n");

      Logger.debug(`檢視日誌 ${logId}，共 ${entries.length} 條記錄`);

      // 建立並顯示 modal
      this.showLogViewModal(logId, stats, jsonlContent);
    } catch (error) {
      Logger.error("檢視日誌失敗:", error);
    }
  }


  /**
   * 更新日誌檔案的受試者名稱（PATCH 到 server）
   * @param {string} filename - 檔案名稱（作為 logId）
   * @param {string} newName - 新的受試者名稱
   */
  async updateParticipantName(filename, newName) {
    newName = (newName || "").trim();
    if (!newName) {
      Logger.warn("受試者名稱不可為空");
      return;
    }

    try {
      const apiUrl = this._getApiUrl();
      const safeFilename = filename.endsWith(".jsonl")
        ? filename
        : `${filename}.jsonl`;

      const resp = await fetch(
        `${apiUrl}/experiment-logs/update-participant/${encodeURIComponent(safeFilename)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participant: newName }),
        },
      );

      const result = await resp.json();
      if (!result.success) {
        throw new Error(result.error || "更新失敗");
      }

      // 更新 modal 顯示
      const displayEl = document.getElementById("modal-participant-display");
      const inputEl = document.getElementById("modal-participant-input");
      const editBtn = document.getElementById("modal-participant-edit-btn");
      const saveBtn = document.getElementById("modal-participant-save-btn");
      const cancelBtn = document.getElementById("modal-participant-cancel-btn");

      if (displayEl) displayEl.textContent = newName;
      if (inputEl) {
        inputEl.style.display = "none";
      }
      if (displayEl) displayEl.style.display = "";
      if (editBtn) editBtn.style.display = "";
      if (saveBtn) saveBtn.style.display = "none";
      if (cancelBtn) cancelBtn.style.display = "none";

      // 更新 currentExperiments 快取
      const cached = this.currentExperiments.find(
        (e) => e.filename === filename || e.filename === safeFilename,
      );
      if (cached) {
        cached.participantName = newName;
        if (cached.logs) {
          cached.logs.forEach((entry) => {
            if (entry.type === "exp_start" || entry.type === "exp_end") {
              entry.participant = newName;
            }
          });
        }
      }

      Logger.debug(`受試者名稱已更新: ${filename} → ${newName}`);
    } catch (error) {
      Logger.error("更新受試者名稱失敗:", error);
    }
  }

  /**
   * 下載指定ID的日誌（從已載入的實驗列表）
   * @param {string} logId - 日誌ID（實驗ID）
   */
  async downloadLogById(logId) {
    try {
      Logger.debug(`正在下載實驗日誌: ${logId}`);

      // 從已載入的列表中找到對應的實驗（優先用 filename 比對）
      const experiment = this.currentExperiments.find(
        (exp) =>
          exp.filename === logId ||
          exp.actualExperimentId === logId ||
          exp.experimentId === logId,
      );

      if (!experiment || !experiment.filename) {
        Logger.warn(
          `找不到實驗 ${logId} 的檔案，currentExperiments 長度: ${this.currentExperiments.length}`,
        );
        return;
      }

      // 透過 API 讀取檔案內容
      const apiUrl = this._getApiUrl();
      const response = await fetch(
        `${apiUrl}/experiment-logs/read/${experiment.filename}`,
      );

      if (!response.ok) {
        throw new Error(`API 回傳錯誤: ${response.status}`);
      }

      const result = await response.json();
      if (!result.success || !result.content) {
        throw new Error(result.error || "無法讀取檔案內容");
      }

      // 產生下載
      const blob = new Blob([result.content], { type: "application/x-ndjson" });
      const filename = experiment.filename;

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      Logger.debug(`已下載日誌：${filename}`);
    } catch (error) {
      Logger.error("下載日誌失敗:", error);
    }
  }

  /**
   * 刪除指定ID的日誌（從伺服器）
   * @param {string} logId - 日誌ID（實驗ID）
   */
  async deleteLogById(logId) {
    try {
      Logger.debug(`正在刪除實驗日誌: ${logId}`);

      // 從已載入的列表中找到對應的實驗（優先用 filename 比對）
      const experiment = this.currentExperiments.find(
        (exp) =>
          exp.filename === logId ||
          exp.actualExperimentId === logId ||
          exp.experimentId === logId,
      );

      if (!experiment || !experiment.filename) {
        Logger.warn(
          `找不到實驗 ${logId} 的檔案，currentExperiments 長度: ${this.currentExperiments.length}`,
        );
        return;
      }

      // 透過 API 刪除檔案
      const apiUrl = this._getApiUrl();
      const response = await fetch(
        `${apiUrl}/experiment-logs/delete/${experiment.filename}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        throw new Error(`API 回傳錯誤: ${response.status}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || "刪除失敗");
      }

      Logger.debug(`已刪除日誌：${experiment.filename}`);

      // 重新載入列表
      this.loadExperimentLogs();
    } catch (error) {
      Logger.error("刪除日誌失敗:", error);
    }
  }

  /**
   * 批次下載選取的日誌（從伺服器）
   */
  async downloadSelectedLogs() {
    if (this.selectedLogs.size === 0) {
      Logger.warn("請先選取要下載的日誌");
      return;
    }

    try {
      const logIds = Array.from(this.selectedLogs);
      const apiUrl = this._getApiUrl();
      let allContent = "";
      let successCount = 0;

      // 逐個下載並合併
      for (const logId of logIds) {
        try {
          // 從已載入的列表中找到對應的實驗（優先用 filename 比對）
          const experiment = this.currentExperiments.find(
            (exp) =>
              exp.filename === logId ||
              exp.actualExperimentId === logId ||
              exp.experimentId === logId,
          );

          if (!experiment || !experiment.filename) {
            Logger.warn(`找不到實驗 ${logId} 的檔案，跳過`);
            continue;
          }

          // 透過 API 讀取檔案內容
          const response = await fetch(
            `${apiUrl}/experiment-logs/read/${experiment.filename}`,
          );

          if (response.ok) {
            const result = await response.json();
            if (result.success && result.content) {
              allContent += `\n=== Experiment: ${logId} (${experiment.filename}) ===\n${result.content}\n`;
              successCount++;
            }
          }
        } catch (error) {
          Logger.warn(`下載日誌 ${logId} 失敗:`, error.message);
        }
      }

      if (!allContent) {
        Logger.warn("沒有可下載的日誌資料");
        return;
      }

      // 下載為單一檔案
      const blob = new Blob([allContent], { type: "text/plain" });
      const filename = `experiment_logs_batch_${
        new Date().toISOString().split("T")[0]
      }.txt`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      Logger.debug(`已批次下載 ${successCount}/${logIds.length} 個日誌`);
    } catch (error) {
      Logger.error("批次下載失敗:", error);
    }
  }

  /**
   * 批次刪除選取的日誌（從伺服器）
   */
  async deleteSelectedLogs() {
    if (this.selectedLogs.size === 0) {
      Logger.warn("請先選取要刪除的日誌");
      return;
    }

    try {
      const logIds = Array.from(this.selectedLogs);
      const apiUrl = this._getApiUrl();
      let deletedCount = 0;

      // 逐個刪除
      for (const logId of logIds) {
        try {
          // 從已載入的列表中找到對應的實驗（優先用 filename 比對）
          const experiment = this.currentExperiments.find(
            (exp) =>
              exp.filename === logId ||
              exp.actualExperimentId === logId ||
              exp.experimentId === logId,
          );

          if (!experiment || !experiment.filename) {
            Logger.warn(`找不到實驗 ${logId} 的檔案，跳過`);
            continue;
          }

          // 透過 API 刪除檔案
          const response = await fetch(
            `${apiUrl}/experiment-logs/delete/${experiment.filename}`,
            {
              method: "DELETE",
            },
          );

          if (response.ok) {
            const result = await response.json();
            if (result.success) {
              deletedCount++;
            }
          }
        } catch (error) {
          Logger.warn(`刪除日誌 ${logId} 失敗:`, error.message);
        }
      }

      Logger.debug(`已批次刪除 ${deletedCount}/${logIds.length} 個日誌`);

      this.selectedLogs.clear();
      this.loadExperimentLogs(); // 重新載入列表
    } catch (error) {
      Logger.error("批次刪除失敗:", error);
    }
  }

  /**
   * 初始化 BroadcastChannel 監聽日誌更新事件
   * 當其他分頁或目前分頁有新的日誌儲存時，自動更新列表
   * @private
   */
  _initBroadcastChannel() {
    try {
      this.broadcastChannel = new BroadcastChannel("ExperimentLogsChannel");

      this.broadcastChannel.onmessage = (event) => {
        const { type, data, senderTabId } = event.data;

        switch (type) {
          case "logsSynced":
            Logger.debug(
              `[ExperimentLogUI] 偵測到日誌已儲存 (分頁 ${senderTabId})，自動更新日誌列表`,
            );
            if (
              data?.source &&
              data.source !== "experiment_completion" &&
              data.source !== "runtime_saved"
            ) {
              return;
            }
            // 自動更新日誌列表
            this.loadExperimentLogs();
            break;
          case "experimentDeleted":
            Logger.debug(
              `[ExperimentLogUI] 偵測到實驗被刪除 (分頁 ${senderTabId})，重新載入列表`,
            );
            // 自動重新載入列表
            this.loadExperimentLogs();
            break;
          case "logsCleared":
            Logger.debug(
              `[ExperimentLogUI] 偵測到日誌被清空 (分頁 ${senderTabId})，重新載入列表`,
            );
            // 自動重新載入列表
            this.loadExperimentLogs();
            break;
        }
      };

      Logger.debug(
        "[ExperimentLogUI] BroadcastChannel 初始化完成，已啟動日誌自動更新監聽",
      );
    } catch (error) {
      Logger.warn(
        "[ExperimentLogUI] BroadcastChannel 不支援，日誌列表需要手動刷新:",
        error,
      );
    }
  }

  _closeBroadcastChannel() {
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
  }

  destroy() {
    this._closeBroadcastChannel();
  }

  /**
   * 更新同步按鈕狀態
   * @param {string} state - 狀態：'show', 'hide', 'disabled', 'enabled'
   * @param {number} logCount - 目前日誌數量（用於 disabled 判斷）
   */
  updateSyncButtonState(state, logCount = 0) {
    const btn = document.getElementById("syncLogsNowBtn");
    if (!btn) return;

    switch (state) {
      case "show":
        btn.classList.remove("is-hidden");
        // 根據日誌數量決定是否停用
        if (logCount > 0) {
          btn.disabled = false;
          btn.title = `立即同步日誌到其他裝置 (目前 ${logCount} 筆)`;
        } else {
          btn.disabled = true;
          btn.title = "暫無日誌可發送";
        }
        break;
      case "hide":
        btn.classList.add("is-hidden");
        break;
      case "disabled":
        btn.disabled = true;
        btn.title = "暫無日誌可發送";
        break;
      case "enabled":
        btn.disabled = false;
        btn.title = `立即同步日誌到其他裝置 (目前 ${logCount} 筆)`;
        break;
    }
  }
}

Object.assign(
  ExperimentLogUI.prototype,
  logFilterPanel,
  logModalPanel,
  logListPanel,
  logStatsReport,
);

// 建立全域實例
const experimentLogUI = new ExperimentLogUI();

// ES6 模組匯出
export { experimentLogUI };
