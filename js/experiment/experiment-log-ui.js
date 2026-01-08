/**
 * ExperimentLogUI - 實驗日誌 UI 管理系統
 * 負責處理實驗日誌的下載、載入、刪除等 UI 操作
 */

class ExperimentLogUI {
  constructor() {
    this.apiUrl = "php/experiment-log-api.php";
    this.selectedLogs = new Set();
  }

  /**
   * 下載目前實驗日誌
   */
  downloadExperimentLog() {
    const experimentId = document.getElementById("experimentIdInput").value;
    const participantName = document.getElementById("subjectName").value;

    if (!experimentId || !participantName) {
      alert("請先設定實驗ID和參與者名稱");
      return;
    }

    const filename = `${experimentId}_${participantName}_experiment_log.jsonl`;
    const url = `${
      this.apiUrl
    }?action=download_jsonl&experiment_id=${encodeURIComponent(
      experimentId
    )}&participant_name=${encodeURIComponent(participantName)}`;

    // 建立臨時連結並觸發下載
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * 載入實驗日誌列表
   */
  async loadExperimentLogs() {
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "list_experiments",
        }),
      });
      const data = await response.json();

      if (data.success) {
        this.displayExperimentLogs(data.experiments);
      } else {
        Logger.warn("載入日誌列表失敗:", data.message);
        alert("載入日誌列表失敗: " + data.message);
      }
    } catch (error) {
      Logger.error("載入日誌列表時發生錯誤:", error);
      alert("載入日誌列表時發生錯誤");
    }
  }

  /**
   * 顯示實驗日誌列表
   * @param {Array} logs - 日誌列表
   */
  displayExperimentLogs(logs) {
    const container = document.getElementById("experimentLogsContainer");
    if (!container) return;

    if (logs.length === 0) {
      container.innerHTML = '<div class="no-logs">目前沒有任何實驗日誌</div>';
      return;
    }

    container.innerHTML = logs
      .map(
        (log) => `
      <div class="log-item" data-log-id="${log.exp_id}">
        <div class="log-info">
          <div class="log-checkbox">
            <input type="checkbox" id="log-${
              log.exp_id
            }" onchange="experimentLogUI.toggleLogSelection('${log.exp_id}')">
            <label for="log-${log.exp_id}"></label>
          </div>
          <div class="log-details">
            <div class="log-filename">${log.file}</div>
            <div class="log-meta">
              <span class="log-size">${this.formatFileSize(log.size)}</span>
              <span class="log-date">${this.formatDate(log.modified)}</span>
            </div>
          </div>
        </div>
        <div class="log-actions">
          <button class="btn btn-info btn-icon-only" onclick="experimentLogUI.viewLogDetails('${
            log.exp_id
          }')" title="檢視">
            <svg class="icon-view" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
          <button class="btn btn-primary btn-icon-only" onclick="experimentLogUI.downloadLogById('${
            log.exp_id
          }')" title="下載">
            <svg class="icon-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 17V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V17"></path>
              <path d="M8 12L12 16L16 12"></path>
              <path d="M12 3V16"></path>
            </svg>
          </button>
          <button class="btn btn-danger btn-icon-only" onclick="experimentLogUI.deleteLogById('${
            log.exp_id
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
          timeZone: window.timeSyncManager?.timezone || "Asia/Taipei",
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
   * 更新批量刪除按鈕狀態
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
   * 檢視日誌詳細資訊
   * @param {string} logId - 日誌ID
   */
  async viewLogDetails(logId) {
    try {
      // 取得日誌原始資料
      const response = await fetch(
        `${this.apiUrl}?action=get_jsonl_content&exp_id=${logId}`
      );

      if (!response.ok) {
        throw new Error("無法取得日誌詳細資訊");
      }

      const data = await response.json();
      const jsonlContent = data.content || "";

      // 解析 JSONL 來計算統計資訊
      const lines = jsonlContent
        .trim()
        .split("\n")
        .filter((line) => line.trim());
      const entries = lines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch (e) {
            return null;
          }
        })
        .filter((e) => e !== null);

      // 計算統計資訊
      const stats = this.calculateLogStatistics(entries);

      // 調試：輸出解析結果
      Logger.info("解析的日誌條目數:", entries.length);
      Logger.info("計算的統計:", stats);

      // 創建並顯示 modal
      this.showLogViewModal(logId, stats, jsonlContent);
    } catch (error) {
      Logger.error("檢視日誌時發生錯誤:", error);
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
      participantName: "",
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
        stats.participantName = entry.participant || "";
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
            timeZone: window.timeSyncManager?.timezone || "Asia/Taipei",
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
                      stats.participantName || "N/A"
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
   * 下載指定ID的日誌
   * @param {string} logId - 日誌ID
   */
  async downloadLogById(logId) {
    try {
      const response = await fetch(
        `${this.apiUrl}?action=download_jsonl&exp_id=${logId}`
      );
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);

        // 從響應頭中取得檔案名稱
        const contentDisposition = response.headers.get("Content-Disposition");
        let filename = `experiment_log_${logId}.jsonl`;
        if (contentDisposition) {
          const matches = contentDisposition.match(
            /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/
          );
          if (matches && matches[1]) {
            filename = matches[1].replace(/['"]/g, "");
          }
        }

        // 建立臨時連結並觸發下載
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } else {
        const errorData = await response.json();
        alert("下載失敗: " + (errorData.message || "未知錯誤"));
      }
    } catch (error) {
      Logger.error("下載日誌時發生錯誤:", error);
      alert("下載日誌時發生錯誤");
    }
  }

  /**
   * 刪除指定ID的日誌
   * @param {string} logId - 日誌ID
   */
  async deleteLogById(logId) {
    if (!confirm("確定要刪除這個日誌檔案嗎？此操作無法還原。")) {
      return;
    }

    try {
      const response = await fetch(`${this.apiUrl}?action=delete&id=${logId}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (data.success) {
        alert("日誌已成功刪除");
        this.loadExperimentLogs(); // 重新載入列表
      } else {
        alert("刪除失敗: " + data.message);
      }
    } catch (error) {
      Logger.error("刪除日誌時發生錯誤:", error);
      alert("刪除日誌時發生錯誤");
    }
  }

  /**
   * 批量下載選取的日誌
   */
  async downloadSelectedLogs() {
    if (this.selectedLogs.size === 0) {
      alert("請先選取要下載的日誌");
      return;
    }

    const logIds = Array.from(this.selectedLogs);
    const url = `${this.apiUrl}?action=download_multiple&ids=${logIds.join(
      ","
    )}`;

    try {
      const response = await fetch(url);
      if (response.ok) {
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = `experiment_logs_batch_${
          new Date().toISOString().split("T")[0]
        }.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);
      } else {
        const errorData = await response.json();
        alert("批量下載失敗: " + (errorData.message || "未知錯誤"));
      }
    } catch (error) {
      Logger.error("批量下載日誌時發生錯誤:", error);
      alert("批量下載日誌時發生錯誤");
    }
  }

  /**
   * 批量刪除選取的日誌
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

    const logIds = Array.from(this.selectedLogs);

    try {
      const response = await fetch(`${this.apiUrl}?action=delete_multiple`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ids: logIds }),
      });

      const data = await response.json();

      if (data.success) {
        alert(`已成功刪除 ${data.deleted_count} 個日誌檔案`);
        this.selectedLogs.clear();
        this.loadExperimentLogs(); // 重新載入列表
      } else {
        alert("批量刪除失敗: " + data.message);
      }
    } catch (error) {
      Logger.error("批量刪除日誌時發生錯誤:", error);
      alert("批量刪除日誌時發生錯誤");
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

// 頁面載入時自動載入日誌列表
window.addEventListener("DOMContentLoaded", () => {
  experimentLogUI.loadExperimentLogs();
});
