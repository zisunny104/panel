/**
 * ExperimentLogUI - 實驗日誌 UI 管理系統
 * 負責處理實驗日誌的下載、載入、刪除等 UI 操作
 * 使用 IndexedDB 作為資料來源
 */

class ExperimentLogUI {
  constructor() {
    this.syncEnabled = false;
    this.currentExperiments = []; // 快取已載入的實驗列表
    this.selectedLogs = new Set();
    this.logManager = null; // 將在初始化時設定
  }

  /**
   * 初始化 UI 管理器
   */
  initialize() {
    // 取得全域的 experimentLogManager 實例
    this.logManager = window.experimentLogManager;
    if (!this.logManager) {
      Logger.warn("[ExperimentLogUI] experimentLogManager 未初始化");
    }
  }

  /**
   * 下載目前實驗日誌（從 IndexedDB）
   */
  async downloadExperimentLog() {
    if (!this.logManager) {
      alert("日誌管理器未初始化");
      return;
    }

    const experimentId = document.getElementById("experimentIdInput")?.value;
    const subjectName = document.getElementById("subjectName")?.value;

    if (!experimentId || !subjectName) {
      alert("請先設定實驗ID和受試者名稱");
      return;
    }

    try {
      // 從 IndexedDB 取得目前實驗的日誌
      const logs = await this.logManager.getAllLogs();

      if (logs.length === 0) {
        alert("目前沒有可下載的日誌");
        return;
      }

      // 產生 JSONL 格式
      const jsonlContent = logs.map((log) => JSON.stringify(log)).join("\n");
      const blob = new Blob([jsonlContent], { type: "application/x-ndjson" });

      // 下載
      const filename = `${experimentId}_${subjectName}_experiment_log.jsonl`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      Logger.info(`[ExperimentLogUI] 已下載日誌：${filename}`);
    } catch (error) {
      Logger.error("[ExperimentLogUI] 下載日誌失敗:", error);
      alert("下載日誌失敗");
    }
  }

  /**
   * 載入實驗日誌列表（從 runtime/experiment-data/ 資料夾）
   */
  async loadExperimentLogs() {
    try {
      // 從 config.json 讀取日誌目錄路徑
      const logsDir = await this.getLogsDirectory();
      const experiments = await this.loadExperimentLogsFromDirectory(logsDir);

      Logger.debug(
        `[ExperimentLogUI] 從檔案系統載入 ${experiments.length} 個實驗日誌`
      );
      this.displayExperimentLogs(experiments);
    } catch (error) {
      Logger.error("[ExperimentLogUI] 載入日誌列表失敗:", error);
      this.displayExperimentLogs([]);
    }
  }

  /**
   * 從 config.json 讀取日誌目錄路徑
   * @returns {Promise<string>} 日誌目錄路徑
   */
  async getLogsDirectory() {
    try {
      if (window.CONFIG?.experiment?.logsDirectory) {
        return window.CONFIG.experiment.logsDirectory;
      }
      // 如果無法從 config 讀取，使用預設值
      return "runtime/experiment-data";
    } catch (error) {
      Logger.warn("[ExperimentLogUI] 無法從 config 讀取日誌目錄，使用預設值");
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

      Logger.debug(`[ExperimentLogUI] 找到 ${files.length} 個檔案`);

      for (const filename of files) {
        if (!filename.endsWith(".jsonl")) continue;

        try {
          // 透過 API 讀取檔案內容
          const apiUrl = this._getApiUrl();
          const response = await fetch(
            `${apiUrl}/api/experiment-logs/read/${filename}`
          );

          if (!response.ok) {
            Logger.debug(`[ExperimentLogUI] 無法讀取檔案: ${filename}`);
            continue;
          }

          const result = await response.json();
          if (!result.success || !result.content) {
            Logger.debug(
              `[ExperimentLogUI] 檔案 ${filename} 讀取失敗: ${result.error}`
            );
            continue;
          }

          const logs = this.parseJSONL(result.content);

          if (logs.length === 0) {
            Logger.debug(`[ExperimentLogUI] 檔案 ${filename} 無有效日誌`);
            continue;
          }

          // 從檔名解析實驗 ID（移除 _timestamp 後綴）
          const match = filename.match(/^(.+?)(?:_\d+)?\.jsonl$/);
          const experimentId = match
            ? match[1]
            : filename.replace(".jsonl", "");

          // 從日誌中找受試者名稱和實驗組合（容錯處理）
          const expStartLog = logs.find(
            (log) => log.type === "exp_start" || log.type === "experiment_start"
          );
          const subjectName = expStartLog?.subject_name || "n/a";
          const combinationName = expStartLog?.combination || "n/a";

          experiments.push({
            experimentId,
            subjectName,
            combinationName,
            filename: filename,
            filePath: filename, // 只存檔案名稱，實際讀取透過 API
            logCount: logs.length,
            startTime: logs[0]?.ts || Date.now(),
            endTime: logs[logs.length - 1]?.ts || Date.now(),
            logs,
            // 用於實際操作的 ID
            actualExperimentId: experimentId,
          });

          Logger.debug(
            `[ExperimentLogUI] 成功載入: ${filename} (${logs.length} 條記錄)`
          );
        } catch (error) {
          Logger.debug(
            `[ExperimentLogUI] 解析檔案 ${filename} 失敗:`,
            error.message
          );
          // 即使解析失敗，也嘗試顯示基本資訊
          const match = filename.match(/^(.+?)(?:_\d+)?\.jsonl$/);
          const experimentId = match
            ? match[1]
            : filename.replace(".jsonl", "");

          experiments.push({
            experimentId,
            subjectName: "n/a",
            combinationName: "n/a",
            filename: filename,
            filePath: filename, // 只存檔案名稱
            logCount: 0,
            startTime: Date.now(),
            endTime: Date.now(),
            logs: [],
            actualExperimentId: experimentId,
            error: error.message,
          });
        }
      }

      // 按開始時間排序（最新的在前）
      experiments.sort((a, b) => b.startTime - a.startTime);
    } catch (error) {
      Logger.error("[ExperimentLogUI] 讀取目錄失敗:", error);
    }

    return experiments;
  }

  /**
   * 列出目錄中的檔案
   * @param {string} dirPath - 目錄路徑
   */
  async listFilesInDirectory(dirPath) {
    try {
      // 嘗試從伺服器 API 獲取檔案列表
      const apiUrl = this._getApiUrl();
      const response = await fetch(`${apiUrl}/api/experiment-logs/list`);

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.files) {
          Logger.debug(
            `[ExperimentLogUI] 從 API 讀取到 ${result.files.length} 個檔案`
          );
          return result.files.map((f) => f.filename);
        }
      }
    } catch (error) {
      Logger.debug(
        "[ExperimentLogUI] API 不可用，無法動態讀取檔案列表",
        error.message
      );
    }

    // 瀏覽器無法直接列出本機目錄，必須啟動伺服器
    Logger.warn(
      "[ExperimentLogUI] 無法讀取實驗日誌檔案。請啟動伺服器：cd server && npm start"
    );
    return [];
  }

  /**
   * 取得 API URL
   * @private
   */
  _getApiUrl() {
    const protocol = window.location.protocol;
    const host = window.location.hostname;
    const port = "7645";
    return `${protocol}//${host}:${port}`;
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
          Logger.warn("[ExperimentLogUI] 無法解析行:", line);
          return null;
        }
      })
      .filter((log) => log !== null);
  }

  /**
   * 顯示實驗日誌列表
   * @param {Array} experiments - 實驗列表
   */
  displayExperimentLogs(experiments) {
    // 保存列表供後續查詢使用
    this.currentExperiments = experiments;

    const container = document.getElementById("experimentLogsContainer");
    if (!container) return;

    if (experiments.length === 0) {
      container.innerHTML = '<div class="no-logs">目前沒有任何實驗日誌</div>';
      return;
    }

    container.innerHTML = experiments
      .map(
        (exp) => `
      <div class="log-item" data-log-id="${
        exp.actualExperimentId || exp.experimentId
      }">
        <div class="log-info">
          <div class="log-checkbox">
            <input type="checkbox" id="log-${
              exp.actualExperimentId || exp.experimentId
            }" onchange="experimentLogUI.toggleLogSelection('${
          exp.actualExperimentId || exp.experimentId
        }')">
            <label for="log-${
              exp.actualExperimentId || exp.experimentId
            }"></label>
          </div>
          <div class="log-details">
            <div class="log-filename">${
              exp.filename ||
              `${exp.experimentId}_${exp.subjectName}_experiment_log.jsonl`
            }</div>
            <div class="log-meta">
              <span class="log-size">${exp.logCount} 條記錄</span>
              ${
                exp.startTime
                  ? `<span class="log-date">${this.formatDate(
                      exp.startTime
                    )}</span>`
                  : ""
              }
            </div>
          </div>
        </div>
        <div class="log-actions">
          <button class="btn btn-info btn-icon-only" onclick="experimentLogUI.viewLogDetails('${
            exp.actualExperimentId || exp.experimentId
          }')" title="檢視">
            <svg class="icon-view" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
          <button class="btn btn-primary btn-icon-only" onclick="experimentLogUI.downloadLogById('${
            exp.actualExperimentId || exp.experimentId
          }')" title="下載">
            <svg class="icon-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 17V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V17"></path>
              <path d="M8 12L12 16L16 12"></path>
              <path d="M12 3V16"></path>
            </svg>
          </button>
          <button class="btn btn-danger btn-icon-only" onclick="experimentLogUI.deleteLogById('${
            exp.actualExperimentId || exp.experimentId
          }')" title="刪除">
            <svg class="icon-delete" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3,6 5,6 21,6"></polyline>
              <path d="m19,6v14a2,2 0 0,1-2,2H7a2,2 0 0,1-2-2V6m3,0V4a2,2 0 0,1,2-2h4a2,2 0 0,1,2,2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
      </div>
    `
      )
      .join("");

    this.updateDeleteButton();
  }

  /**
   * 格式化檔案大小
   * @param {number} bytes - 字節數
   * @returns {string} 格式化的檔案大小
   */
  formatFileSize(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  /**
   * 格式化日期
   * @param {string|number} dateString - 日期字符串或毫秒級時間戳
   * @returns {string} 格式化的日期時間
   */
  formatDate(dateString) {
    return window.timeSyncManager
      ? window.timeSyncManager.formatDateTime(dateString)
      : new Date(dateString).toLocaleString("zh-TW", {
          timeZone: window.CONFIG?.timezone || "Asia/Taipei",
        });
  }

  /**
   * 切換日誌選擇狀態
   * @param {string} logId - 日誌ID
   */
  toggleLogSelection(logId) {
    if (this.selectedLogs.has(logId)) {
      this.selectedLogs.delete(logId);
    } else {
      this.selectedLogs.add(logId);
    }
    this.updateDeleteButton();
  }

  /**
   * 更新批次刪除按鈕狀態
   */
  updateDeleteButton() {
    const deleteSelectedBtn = document.getElementById("deleteSelectedLogsBtn");
    const downloadSelectedBtn = document.getElementById(
      "downloadSelectedLogsBtn"
    );
    const count = this.selectedLogs.size;

    if (deleteSelectedBtn) {
      deleteSelectedBtn.style.display = count > 0 ? "inline-block" : "none";
      deleteSelectedBtn.textContent =
        count > 0 ? `刪除選取項目 (${count})` : "刪除選取項目";
    }
    if (downloadSelectedBtn) {
      downloadSelectedBtn.style.display = count > 0 ? "inline-block" : "none";
    }
  }

  /**
   * 檢視日誌詳細資訊（從檔案）
   * @param {string} logId - 日誌ID（實驗ID）
   */
  async viewLogDetails(logId) {
    try {
      Logger.debug(`[ExperimentLogUI] 正在查看實驗日誌: ${logId}`);

      // 從已載入的列表中找到對應的實驗
      const experiment = this.currentExperiments.find(
        (exp) => exp.actualExperimentId === logId || exp.experimentId === logId
      );

      if (!experiment || !experiment.logs || experiment.logs.length === 0) {
        Logger.warn(`[ExperimentLogUI] 找不到實驗 ${logId} 的日誌資料`);
        alert(`找不到該實驗的日誌資料\n實驗ID: ${logId}`);
        return;
      }

      const entries = experiment.logs;
      Logger.debug(`[ExperimentLogUI] 找到 ${entries.length} 條日誌記錄`);

      // 計算統計資訊
      const stats = this.calculateLogStatistics(entries);

      // 產生 JSONL 內容
      const jsonlContent = entries.map((e) => JSON.stringify(e)).join("\n");

      Logger.debug(
        `[ExperimentLogUI] 檢視日誌 ${logId}，共 ${entries.length} 條記錄`
      );

      // 建立並顯示 modal
      this.showLogViewModal(logId, stats, jsonlContent);
    } catch (error) {
      Logger.error("[ExperimentLogUI] 檢視日誌失敗:", error);
      alert("無法取得日誌詳細資訊: " + error.message);
    }
  }

  /**
   * 計算日誌統計資訊
   * @param {Array} entries - 日誌條目陣列
   * @returns {Object} 統計資訊物件
   */
  calculateLogStatistics(entries) {
    const stats = {
      // 基本資料
      experimentId: "",
      subjectName: "",
      experimentCombination: "",
      startTime: null,
      endTime: null,
      totalDuration: 0,

      // 統計資訊
      totalUnits: 0,
      totalGesturesPlanned: 0,
      totalGesturesRecorded: 0,
      totalActionsRecorded: 0,
      gestureStats: {},
      overallAccuracy: 0,
    };

    if (entries.length === 0) return stats;

    // 收集基本資料和統計資訊
    const unitsStarted = new Set(); // 用於計算不同單元的數量
    const gesturesPlanned = new Map(); // 用於計算計劃的手勢統計
    const gestureIndexToName = new Map(); // 建立 g_idx 到 g_name 的映射

    // 第一輪：收集 g_idx 到 g_name 的映射
    entries.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      if (
        entry.type === "gesture_step_start" &&
        entry.g_name &&
        entry.g_idx !== undefined
      ) {
        gestureIndexToName.set(entry.g_idx, entry.g_name);
      }
    });

    // 第二輪：進行統計計算
    entries.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;

      // 從實驗開始事件取得基本資料
      if (entry.type === "exp_start") {
        stats.experimentId = entry.exp_id || "";
        stats.subjectName = entry.subject_name || "";
        // 嘗試從組合名稱欄位取得
        stats.experimentCombination =
          entry.combination_name || entry.combo_name || "";

        // 轉換時間戳（ts 可能是毫秒）
        if (entry.ts) {
          const ts =
            typeof entry.ts === "string" ? parseInt(entry.ts) : entry.ts;
          stats.startTime = new Date(ts);
        }
      }

      // 從實驗結束事件取得結束時間
      if (entry.type === "exp_end") {
        if (entry.ts) {
          const ts =
            typeof entry.ts === "string" ? parseInt(entry.ts) : entry.ts;
          stats.endTime = new Date(ts);
        }
      }

      // 計算單元數量 - 基於 gesture_step_start 的步驟ID
      if (entry.type === "gesture_step_start") {
        if (entry.s_id) {
          // 從步驟ID提取單元ID（通常格式為 UNIT_ID_number）
          // 只計算看起來像單元的ID（以字母開頭，包含數字，如 SA03, A001, SA01 等）
          const parts = entry.s_id.split("_");
          if (parts.length > 0) {
            const potentialUnitId = parts[0];
            // 檢查是否是真正的單元ID（不是系統級步驟如 SYSTEM, SECTION 等）
            // 真正的單元ID通常包含數字（如 SA03, A001）或是已知的系統ID
            const isActualUnit = /[0-9]/.test(potentialUnitId);
            if (isActualUnit) {
              unitsStarted.add(potentialUnitId);
            }
          }
        }

        // 計算計劃的手勢 - 使用手勢名稱作為唯一鍵
        const gestureName = entry.g_name || `gesture_${entry.g_idx || 0}`;
        if (!gesturesPlanned.has(gestureName)) {
          gesturesPlanned.set(gestureName, 1);
        } else {
          gesturesPlanned.set(
            gestureName,
            gesturesPlanned.get(gestureName) + 1
          );
        }
        stats.totalGesturesPlanned++;
      } else if (entry.type === "gesture_step_end") {
        stats.totalGesturesRecorded++;
      }

      // 手勢嘗試（用於統計正確性）
      if (entry.type === "gesture_attempt") {
        const gestureIndex = entry.g_idx || 0;
        const gestureType = entry.g_type || "n"; // t=正確, f=錯誤, n=未分類

        // 優先使用日誌中的名稱，其次使用映射表，最後使用索引
        let gestureName = entry.g_name;
        if (!gestureName && gestureIndexToName.has(gestureIndex)) {
          gestureName = gestureIndexToName.get(gestureIndex);
        }
        if (!gestureName) {
          gestureName = `gesture_${gestureIndex}`;
        }

        if (!stats.gestureStats[gestureName]) {
          stats.gestureStats[gestureName] = {
            planned: 0,
            recorded: 0,
            correct: 0,
            uncertain: 0,
            incorrect: 0,
            accuracy: 0,
            concordance: 0,
          };
        }

        stats.gestureStats[gestureName].recorded++;

        // 判斷正確性
        if (gestureType === "t") {
          stats.gestureStats[gestureName].correct++;
        } else if (gestureType === "u") {
          stats.gestureStats[gestureName].uncertain++;
        } else if (gestureType === "f") {
          stats.gestureStats[gestureName].incorrect++;
        }
      }

      // Action 統計
      if (entry.type === "action" || entry.type === "action_triggered") {
        stats.totalActionsRecorded++;
      }
    });

    // 設置單元數量
    stats.totalUnits = unitsStarted.size;

    // 更新計劃手勢數量到各手勢統計
    for (const [gestureName, count] of gesturesPlanned) {
      if (stats.gestureStats[gestureName]) {
        stats.gestureStats[gestureName].planned = count;
      } else {
        stats.gestureStats[gestureName] = {
          planned: count,
          recorded: 0,
          correct: 0,
          uncertain: 0,
          incorrect: 0,
          accuracy: 0,
          concordance: 0,
        };
      }
    }

    // 計算總持續時間（秒）
    if (stats.startTime && stats.endTime) {
      stats.totalDuration = Math.round(
        (stats.endTime - stats.startTime) / 1000
      );
    }

    // 計算各手勢的正確率和一致性
    let totalCorrect = 0;
    let totalConcordance = 0;
    let totalGestureCount = 0;

    for (const [gestureName, gestureStat] of Object.entries(
      stats.gestureStats
    )) {
      const total = gestureStat.recorded || 1;
      gestureStat.accuracy = Math.round((gestureStat.correct / total) * 100);
      gestureStat.concordance = Math.round(
        ((gestureStat.correct + gestureStat.uncertain) / total) * 100
      );

      totalCorrect += gestureStat.correct;
      totalConcordance += gestureStat.correct + gestureStat.uncertain;
      totalGestureCount += total;
    }

    // 計算整體正確率
    if (totalGestureCount > 0) {
      stats.overallAccuracy = Math.round(
        (totalCorrect / totalGestureCount) * 100
      );
    }

    return stats;
  }

  /**
   * 顯示日誌檢視 Modal
   * @param {string} logId - 日誌ID
   * @param {Object} stats - 統計資訊
   * @param {string} jsonlContent - JSONL 原始內容
   */
  showLogViewModal(logId, stats, jsonlContent) {
    // 移除已有的 modal（如果存在）
    const existingModal = document.getElementById("logViewModal");
    if (existingModal) {
      existingModal.remove();
    }

    // 格式化持續時間
    const durationStr = this.formatDurationText(stats.totalDuration);
    const startTimeStr = stats.startTime
      ? window.timeSyncManager
        ? window.timeSyncManager.formatDateTime(
            new Date(stats.startTime).getTime()
          )
        : stats.startTime.toLocaleString("zh-TW", {
            timeZone: window.CONFIG?.timezone || "Asia/Taipei",
          })
      : "未知";

    // 建構 gesture 統計 HTML
    let gestureStatsHtml = "";
    if (Object.keys(stats.gestureStats).length > 0) {
      gestureStatsHtml = Object.entries(stats.gestureStats)
        .map(
          ([gestureName, gestureStat]) => `
        <div class="stat-item">
          <span class="stat-label">${gestureName}</span>
          <span class="stat-record">${gestureStat.recorded}/${
            gestureStat.planned || "?"
          }</span>
          <span class="stat-accuracy">${gestureStat.accuracy}%</span>
          <span class="stat-concordance">${gestureStat.concordance}%</span>
        </div>
      `
        )
        .join("");
    }

    // 格式化 JSONL 內容（使用 pre 標籤和可摺疊結構）
    const formattedJsonl = this.formatJsonlForDisplay(jsonlContent);

    // 建立 Modal HTML
    const modalHtml = `
      <div class="modal-overlay active" id="logViewModal">
        <div class="modal-container modal-dialog modal-lg">
          <div class="modal-header">
            <h2 class="modal-title">日誌詳細資訊</h2>
            <button type="button" class="modal-close-btn" onclick="document.getElementById('logViewModal').remove()">×</button>
          </div>

          <div class="modal-body">
            <div class="log-view-container">
              <!-- 實驗基本資料 -->
              <div class="experiment-metadata-section">
                <h3>實驗基本資料</h3>
                <div class="metadata-grid">
                  <div class="metadata-item">
                    <span class="metadata-label">實驗ID：</span>
                    <span class="metadata-value">${this.escapeHtml(
                      stats.experimentId || "N/A"
                    )}</span>
                  </div>
                  <div class="metadata-item">
                    <span class="metadata-label">受試者名稱：</span>
                    <span class="metadata-value">${this.escapeHtml(
                      stats.subjectName || "N/A"
                    )}</span>
                  </div>
                  <div class="metadata-item">
                    <span class="metadata-label">實驗組合：</span>
                    <span class="metadata-value">${this.escapeHtml(
                      stats.experimentCombination || "N/A"
                    )}</span>
                  </div>
                  <div class="metadata-item">
                    <span class="metadata-label">實驗時間：</span>
                    <span class="metadata-value">${startTimeStr}</span>
                  </div>
                </div>
              </div>

              <!-- 統計資訊區 -->
              <div class="statistics-section">
                <h3>實驗統計</h3>
                <div class="stats-view-grid">
                  <div class="stat-card">
                    <div class="stat-label">總持續時間</div>
                    <div class="stat-value">${durationStr}</div>
                  </div>
                  <div class="stat-card">
                    <div class="stat-label">單元數量</div>
                    <div class="stat-value">${stats.totalUnits}</div>
                  </div>
                  <div class="stat-card">
                    <div class="stat-label">手勢（記錄/計畫）</div>
                    <div class="stat-value">${stats.totalGesturesRecorded}/${
      stats.totalGesturesPlanned
    }</div>
                  </div>
                  <div class="stat-card">
                    <div class="stat-label">操作數</div>
                    <div class="stat-value">${stats.totalActionsRecorded}</div>
                  </div>
                  <div class="stat-card">
                    <div class="stat-label">整體正確率</div>
                    <div class="stat-value">${stats.overallAccuracy}%</div>
                  </div>
                </div>

                ${
                  gestureStatsHtml
                    ? `
                  <div class="gesture-stats">
                    <h4>手勢詳細統計</h4>
                    <div class="gesture-stats-header">
                      <span class="header-label">手勢名稱</span>
                      <span class="header-record">記錄/計畫</span>
                      <span class="header-accuracy">正確率</span>
                      <span class="header-concordance">一致性</span>
                    </div>
                    ${gestureStatsHtml}
                  </div>
                `
                    : ""
                }
              </div>

              <!-- JSONL 原始碼區 -->
              <div class="jsonl-section">
                <h3>JSONL 原始碼</h3>
                <div class="jsonl-content">
                  <pre>${this.escapeHtml(formattedJsonl)}</pre>
                </div>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="document.getElementById('logViewModal').remove()">
              關閉
            </button>
            <button class="btn btn-primary" onclick="experimentLogUI.downloadLogById('${logId}')">
              下載
            </button>
          </div>
        </div>
      </div>
    `;

    // 新增 modal 到 DOM
    document.body.insertAdjacentHTML("beforeend", modalHtml);

    // 設定 modal 顯示（使用既有的 modal-overlay 機制）
    const modal = document.getElementById("logViewModal");
    if (modal) {
      modal.style.display = "flex";
    }
  }

  /**
   * 格式化 JSONL 內容以便顯示
   * @param {string} jsonlContent - JSONL 原始內容
   * @returns {string} 格式化後的內容
   */
  formatJsonlForDisplay(jsonlContent) {
    const lines = jsonlContent.trim().split("\n");
    return lines
      .map((line) => {
        try {
          const obj = JSON.parse(line);
          return JSON.stringify(obj, null, 2)
            .split("\n")
            .map((l, i, arr) => {
              // 限制每行的文本長度
              if (l.length > 100) {
                return l.substring(0, 100) + "...";
              }
              return l;
            })
            .join("\n");
        } catch (e) {
          return line;
        }
      })
      .join("\n\n");
  }

  /**
   * 轉義 HTML 特殊字符
   * @param {string} text - 文本
   * @returns {string} 轉義後的文本
   */
  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 格式化持續時間（中文文本格式）
   * @param {number} seconds - 秒數
   * @returns {string} 格式化的持續時間
   */
  formatDurationText(seconds) {
    if (seconds < 60) {
      return `${seconds}秒`;
    }
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes < 60) {
      return `${minutes}分${secs}秒`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}小時${mins}分${secs}秒`;
  }

  /**
   * 下載指定ID的日誌（從已載入的實驗列表）
   * @param {string} logId - 日誌ID（實驗ID）
   */
  async downloadLogById(logId) {
    try {
      Logger.debug(`[ExperimentLogUI] 正在下載實驗日誌: ${logId}`);

      // 從已載入的列表中找到對應的實驗
      const experiment = this.currentExperiments.find(
        (exp) => exp.actualExperimentId === logId || exp.experimentId === logId
      );

      if (!experiment || !experiment.filename) {
        Logger.warn(`[ExperimentLogUI] 找不到實驗 ${logId} 的檔案`);
        alert(`找不到該實驗的日誌檔案\n實驗ID: ${logId}`);
        return;
      }

      // 透過 API 讀取檔案內容
      const apiUrl = this._getApiUrl();
      const response = await fetch(
        `${apiUrl}/api/experiment-logs/read/${experiment.filename}`
      );

      if (!response.ok) {
        throw new Error(`API 返回錯誤: ${response.status}`);
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

      Logger.debug(`[ExperimentLogUI] 已下載日誌：${filename}`);
    } catch (error) {
      Logger.error("[ExperimentLogUI] 下載日誌失敗:", error);
      alert("下載日誌時發生錯誤: " + error.message);
    }
  }

  /**
   * 刪除指定ID的日誌（從伺服器）
   * @param {string} logId - 日誌ID（實驗ID）
   */
  async deleteLogById(logId) {
    if (!confirm("確定要刪除這個日誌檔案嗎？此操作無法還原。")) {
      return;
    }

    try {
      Logger.debug(`[ExperimentLogUI] 正在刪除實驗日誌: ${logId}`);

      // 從已載入的列表中找到對應的實驗
      const experiment = this.currentExperiments.find(
        (exp) => exp.actualExperimentId === logId || exp.experimentId === logId
      );

      if (!experiment || !experiment.filename) {
        Logger.warn(`[ExperimentLogUI] 找不到實驗 ${logId} 的檔案`);
        alert(`找不到該實驗的日誌檔案\n實驗ID: ${logId}`);
        return;
      }

      // 透過 API 刪除檔案
      const apiUrl = this._getApiUrl();
      const response = await fetch(
        `${apiUrl}/api/experiment-logs/delete/${experiment.filename}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        throw new Error(`API 返回錯誤: ${response.status}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || "刪除失敗");
      }

      alert("日誌已成功刪除");
      Logger.debug(`[ExperimentLogUI] 已刪除日誌：${experiment.filename}`);

      // 重新載入列表
      this.loadExperimentLogs();
    } catch (error) {
      Logger.error("[ExperimentLogUI] 刪除日誌失敗:", error);
      alert("刪除日誌時發生錯誤: " + error.message);
    }
  }

  /**
   * 批次下載選取的日誌（從伺服器）
   */
  async downloadSelectedLogs() {
    if (this.selectedLogs.size === 0) {
      alert("請先選取要下載的日誌");
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
          // 從已載入的列表中找到對應的實驗
          const experiment = this.currentExperiments.find(
            (exp) =>
              exp.actualExperimentId === logId || exp.experimentId === logId
          );

          if (!experiment || !experiment.filename) {
            Logger.warn(`[ExperimentLogUI] 找不到實驗 ${logId} 的檔案，跳過`);
            continue;
          }

          // 透過 API 讀取檔案內容
          const response = await fetch(
            `${apiUrl}/api/experiment-logs/read/${experiment.filename}`
          );

          if (response.ok) {
            const result = await response.json();
            if (result.success && result.content) {
              allContent += `\n=== Experiment: ${logId} (${experiment.filename}) ===\n${result.content}\n`;
              successCount++;
            }
          }
        } catch (error) {
          Logger.warn(
            `[ExperimentLogUI] 下載日誌 ${logId} 失敗:`,
            error.message
          );
        }
      }

      if (!allContent) {
        alert("沒有可下載的日誌資料");
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

      Logger.debug(
        `[ExperimentLogUI] 已批次下載 ${successCount}/${logIds.length} 個日誌`
      );
      alert(`已成功下載 ${successCount} 個日誌檔案`);
    } catch (error) {
      Logger.error("[ExperimentLogUI] 批次下載失敗:", error);
      alert("批次下載日誌時發生錯誤: " + error.message);
    }
  }

  /**
   * 批次刪除選取的日誌（從伺服器）
   */
  async deleteSelectedLogs() {
    if (this.selectedLogs.size === 0) {
      alert("請先選取要刪除的日誌");
      return;
    }

    if (
      !confirm(
        `確定要刪除選取的 ${this.selectedLogs.size} 個日誌檔案嗎？此操作無法還原。`
      )
    ) {
      return;
    }

    try {
      const logIds = Array.from(this.selectedLogs);
      const apiUrl = this._getApiUrl();
      let deletedCount = 0;

      // 逐個刪除
      for (const logId of logIds) {
        try {
          // 從已載入的列表中找到對應的實驗
          const experiment = this.currentExperiments.find(
            (exp) =>
              exp.actualExperimentId === logId || exp.experimentId === logId
          );

          if (!experiment || !experiment.filename) {
            Logger.warn(`[ExperimentLogUI] 找不到實驗 ${logId} 的檔案，跳過`);
            continue;
          }

          // 透過 API 刪除檔案
          const response = await fetch(
            `${apiUrl}/api/experiment-logs/delete/${experiment.filename}`,
            {
              method: "DELETE",
            }
          );

          if (response.ok) {
            const result = await response.json();
            if (result.success) {
              deletedCount++;
            }
          }
        } catch (error) {
          Logger.warn(
            `[ExperimentLogUI] 刪除日誌 ${logId} 失敗:`,
            error.message
          );
        }
      }

      alert(`已成功刪除 ${deletedCount} 個日誌檔案`);
      Logger.debug(
        `[ExperimentLogUI] 已批次刪除 ${deletedCount}/${logIds.length} 個日誌`
      );

      this.selectedLogs.clear();
      this.loadExperimentLogs(); // 重新載入列表
    } catch (error) {
      Logger.error("[ExperimentLogUI] 批次刪除失敗:", error);
      alert("批次刪除日誌時發生錯誤: " + error.message);
    }
  }
}

// 建立全域實例
const experimentLogUI = new ExperimentLogUI();

// 關鍵修正：確保在 ES6 Module 模式下也能被 HTML 標籤存取
window.experimentLogUI = experimentLogUI;

// 將方法綁定到 window 物件以保持向後相容性
window.downloadExperimentLog = () => experimentLogUI.downloadExperimentLog();
window.loadExperimentLogs = () => experimentLogUI.loadExperimentLogs();
window.downloadLogById = (logId) => experimentLogUI.downloadLogById(logId);
window.deleteLogById = (logId) => experimentLogUI.deleteLogById(logId);
window.viewLogDetails = (logId) => experimentLogUI.viewLogDetails(logId);
window.downloadSelectedLogs = () => experimentLogUI.downloadSelectedLogs();
window.deleteSelectedLogs = () => experimentLogUI.deleteSelectedLogs();
window.updateDeleteButton = () => experimentLogUI.updateDeleteButton();

// 頁面載入時初始化並載入日誌列表
window.addEventListener("DOMContentLoaded", () => {
  experimentLogUI.initialize();
  experimentLogUI.loadExperimentLogs();
});
