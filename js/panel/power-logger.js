// logger.js - 日誌記錄功能模塊

class LogPanel {
  constructor() {
    // 日誌資料
    this.logEntries = [];
    // 日誌面板相關 DOM
    this.loggerOutput = document.getElementById("loggerOutput");
    this.logContent = document.getElementById("logContent");
    this.loggerFabButton = document.getElementById("loggerFabButton");
    this.loggerPanelMinimized = false;

    // 初始化拖曳狀態
    this.dragState = {
      isDragging: false,
      currentX: 0,
      currentY: 0,
      initialX: 0,
      initialY: 0,
    };

    this.setupEventListeners();
    this.setupDragAndResize();
    this.initializeLoggerState();
  }

  /**
   * 偵測是否在實驗模式
   */
  isExperimentMode() {
    // 檢查實驗按鈕是否隱藏（表示實驗已開始）
    const startExperimentButton = document.getElementById(
      "startExperimentButton"
    );
    if (
      startExperimentButton &&
      startExperimentButton.style.display === "none"
    ) {
      return true;
    }

    // 檢查實驗管理器狀態
    if (window.experiment && window.experiment.isExperimentRunning) {
      return true;
    }

    return false;
  }

  /**
   * 格式化日期時間為 YYYY-MM-DD HH:MM:SS 格式（東八區）
   * @param {Date|number} date - 要格式化的日期物件或毫秒級時間戳
   * @param {Object} options - 選項
   * @returns {string} 格式化後的時間字串
   */
  formatDateTime(date, options = {}) {
    return window.timeSyncManager
      ? window.timeSyncManager.formatDateTime(date, options)
      : (() => {
          const d = typeof date === "number" ? new Date(date) : date;
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, "0");
          const day = String(d.getDate()).padStart(2, "0");
          const hours = String(d.getHours()).padStart(2, "0");
          const minutes = String(d.getMinutes()).padStart(2, "0");
          const seconds = String(d.getSeconds()).padStart(2, "0");
          return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        })();
  }

  /**
   * 在實驗模式下自動最小化 logger
   */
  handleExperimentMode() {
    if (this.isExperimentMode()) {
      this.minimizeLogger();
    }
  }

  /**
   * 記錄動作
   * @param {string} actionMessage - 動作訊息
   * @param {string|null} buttonId - 按鈕ID
   * @param {string|null} functionName - 函數名稱
   * @param {boolean} isKeyboard - 是否鍵盤觸發
   * @param {boolean} isTouch - 是否觸控觸發
   * @param {boolean} isCombo - 是否組合按鈕操作
   * @param {Object} comboDetails - 組合按鈕詳情
   * @param {Object} additionalData - 額外資料
   */
  logAction(
    actionMessage,
    buttonId = null,
    functionName = null,
    isKeyboard = false,
    isTouch = false,
    isCombo = false,
    comboDetails = null,
    additionalData = {}
  ) {
    const now = new Date();
    const timestamp = now.toISOString();
    const formattedTime = this.formatDateTime(now);

    // 取得實驗狀態資訊
    const experimentInfo = this.getExperimentInfo();

    // 判斷動作類型和重要性
    const actionType = this.classifyAction(
      actionMessage,
      buttonId,
      functionName
    );

    const logEntry = {
      timestamp,
      formatted_time: formattedTime,
      action: actionMessage,
      action_type: actionType.type,
      is_experiment_relevant: actionType.isExperimentRelevant,
      button_id: buttonId,
      function_name: functionName,
      is_keyboard_triggered: isKeyboard,
      is_touch_triggered: isTouch,
      is_combo_operation: isCombo,
      combo_details: comboDetails,
      experiment_info: experimentInfo,
      additional_data: additionalData,
    };

    this.logEntries.push(logEntry);

    // 顯示在日誌面板
    this.displayLogEntry(logEntry);
  }

  /**
   * 取得目前實驗狀態資訊
   */
  getExperimentInfo() {
    if (!window.experiment?.isExperimentRunning) {
      return {
        is_running: false,
        experiment_id: null,
        current_unit: null,
        current_step: null,
        unit_index: null,
        step_index: null,
        total_units: null,
        total_steps_in_unit: null,
      };
    }

    const exp = window.experiment;

    // 檢查是否使用 action-based 模式
    if (window.actionManager?.isInitialized) {
      // Action-based 模式
      const currentAction = window.actionManager.getCurrentAction();
      const progressInfo = window.actionManager.getProgress();

      return {
        is_running: true,
        experiment_id: exp.currentExperimentId,
        mode: "action-based",
        current_action: currentAction,
        action_progress: progressInfo,
      };
    } else {
      // 傳統步驟模式
      const unitId = exp.loadedUnits?.[exp.currentUnitIndex];
      const unit = window._allUnits?.find((u) => u.unit_id === unitId);
      const step = unit?.steps?.[exp.currentStepIndex];

      return {
        is_running: true,
        experiment_id: exp.currentExperimentId,
        mode: "step-based",
        current_unit: {
          id: unitId,
          name: unit?.unit_name || "未知單元",
          index: exp.currentUnitIndex,
          total: exp.loadedUnits?.length || 0,
        },
        current_step: {
          id: step?.step_id || "未知步驟",
          name: step?.step_name || "未知步驟",
          index: exp.currentStepIndex,
          total: unit?.steps?.length || 0,
          media: step?.media || null,
        },
      };
    }
  }

  /**
   * 分類動作類型和重要性
   */
  classifyAction(actionMessage, buttonId, functionName) {
    // 系統操作（低重要性）
    const systemActions = [
      "開啟",
      "關閉",
      "顯示",
      "隱藏",
      "調整",
      "設定",
      "載入",
      "清空",
      "面板",
      "設定面板",
      "實驗面板",
      "日誌",
    ];

    // 實驗相關操作（高重要性）
    const experimentActions = [
      "開始實驗",
      "暫停實驗",
      "繼續實驗",
      "停止實驗",
      "結束實驗",
      "開機",
      "關機",
      "等待指令",
      "按鈕",
      "功能",
    ];

    // 電源相關操作（中重要性）
    const powerActions = ["開機", "關機", "電源"];

    const message = actionMessage.toLowerCase();

    if (
      experimentActions.some((keyword) =>
        message.includes(keyword.toLowerCase())
      )
    ) {
      return {
        type: "experiment_action",
        isExperimentRelevant: true,
      };
    } else if (
      powerActions.some((keyword) => message.includes(keyword.toLowerCase()))
    ) {
      return {
        type: "power_action",
        isExperimentRelevant: true,
      };
    } else if (buttonId && functionName) {
      return {
        type: "button_interaction",
        isExperimentRelevant: true,
      };
    } else if (
      systemActions.some((keyword) => message.includes(keyword.toLowerCase()))
    ) {
      return {
        type: "system_action",
        isExperimentRelevant: false,
      };
    } else {
      return {
        type: "general_action",
        isExperimentRelevant: false,
      };
    }
  }

  /**
   * 取得實驗相關日誌的統計資訊
   */
  getExperimentStats() {
    const experimentEntries = this.logEntries.filter(
      (entry) => entry.is_experiment_relevant
    );
    const comboEntries = this.logEntries.filter(
      (entry) => entry.is_combo_operation
    );

    return {
      total_entries: this.logEntries.length,
      experiment_entries: experimentEntries.length,
      system_entries: this.logEntries.length - experimentEntries.length,
      combo_operations: comboEntries.length,
      keyboard_operations: this.logEntries.filter(
        (entry) => entry.is_keyboard_triggered
      ).length,
      touch_operations: this.logEntries.filter(
        (entry) => entry.is_touch_triggered
      ).length,
      unique_buttons: [
        ...new Set(
          this.logEntries
            .filter((entry) => entry.button_id)
            .map((entry) => entry.button_id)
        ),
      ].length,
      unique_functions: [
        ...new Set(
          this.logEntries
            .filter((entry) => entry.function_name)
            .map((entry) => entry.function_name)
        ),
      ].length,
    };
  }

  /**
   * 顯示統計資訊在控制台
   */
  displayStats() {
    const stats = this.getExperimentStats();
    Logger.info("實驗日誌統計:", stats);
    return stats;
  }

  /**
   * 顯示日誌條目在面板中
   */
  displayLogEntry(logEntry) {
    if (!this.logContent) return;

    const logElement = document.createElement("div");
    logElement.className = `log-entry ${logEntry.action_type}`;

    // 根據重要性調整顯示樣式
    if (logEntry.is_experiment_relevant) {
      logElement.classList.add("experiment-relevant");
    }

    let displayText = `[${logEntry.formatted_time}] ${logEntry.action}`;

    // 如果是實驗模式，新增簡潔的進度資訊
    if (logEntry.experiment_info.is_running) {
      if (
        logEntry.experiment_info.mode === "action-based" &&
        logEntry.experiment_info.action_progress
      ) {
        // Action-based 模式：只顯示進度
        const progress = logEntry.experiment_info.action_progress;
        displayText += ` [${progress.current}/${progress.total}]`;
      } else if (
        logEntry.experiment_info.mode === "step-based" &&
        logEntry.experiment_info.current_step
      ) {
        // 傳統步驟模式：只顯示簡潔進度
        const stepInfo = logEntry.experiment_info.current_step;
        displayText += ` [${stepInfo.index + 1}/${stepInfo.total}]`;
      }
    }

    logElement.textContent = displayText;
    this.logContent.appendChild(logElement);
    this.logContent.scrollTop = this.logContent.scrollHeight;
  }

  /**
   * 清空日誌
   */
  clearLog() {
    this.logEntries = [];
    if (this.logContent) {
      this.logContent.innerHTML = "";
    }
    this.logAction("日誌已清空");

    // 重設媒體
    if (window.mediaManager) {
      window.mediaManager.reset();
    }

    // 重設按鈕功能
    if (window.buttonManager) {
      window.buttonManager.buttonFunctionsMap = {};
      window.buttonManager.loadButtonFunctions();
    }
  }

  /**
   * 匯出日誌為 JSON
   */
  exportLog() {
    const logData = JSON.stringify(this.logEntries, null, 2);
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, "0");
    const fileName = `log_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate()
    )}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(
      now.getSeconds()
    )}.json`;

    const blob = new Blob([logData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.logAction("日誌已匯出為 JSON 檔案");
  }

  /**
   * 複製日誌到剪貼簿
   */
  copyLog() {
    // 檢查是否有日誌內容
    if (this.logEntries.length === 0) {
      alert("沒有日誌內容可複製");
      return;
    }

    // 將日誌格式化為可讀的文字
    const logText = this.logEntries
      .map((entry) => {
        const time = this.formatDateTime(new Date(entry.timestamp));
        return `[${time}] ${entry.action} (${entry.action_type || "unknown"})`;
      })
      .join("\n");

    // 嘗試複製到剪貼簿
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(logText)
        .then(() => {
          // 顯示簡短的成功提示
          const copyButton = document.getElementById("copyLogButton");
          const originalText = copyButton.innerHTML;
          copyButton.innerHTML = "";
          copyButton.style.background = "#4CAF50";

          setTimeout(() => {
            copyButton.innerHTML = originalText;
            copyButton.style.background = "#333";
          }, 1500);

          this.logAction("日誌已複製到剪貼簿");
        })
        .catch((err) => {
          Logger.error("複製失敗:", err);
          this.fallbackCopy(logText);
        });
    } else {
      // 降級處理：使用舊的方法
      this.fallbackCopy(logText);
    }
  }

  /**
   * 降級複製方法（當 Clipboard API 不可用時）
   */
  fallbackCopy(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.select();

    try {
      document.execCommand("copy");
      alert("日誌已複製到剪貼簿");
      this.logAction("日誌已複製到剪貼簿");
    } catch (err) {
      Logger.error("降級複製也失敗:", err);
      alert("複製失敗，請手動選取日誌內容");
    } finally {
      document.body.removeChild(textArea);
    }
  }

  /**
   * 安靜模式匯出日誌（不顯示匯出訊息）
   * @param {string|null} experimentId - 實驗ID
   */
  exportLogSilent(experimentId = null) {
    const logData = JSON.stringify(this.logEntries, null, 2);
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, "0");
    let fileName = experimentId
      ? `實驗日誌_${experimentId}_${now.getFullYear()}-${pad(
          now.getMonth() + 1
        )}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(
          now.getMinutes()
        )}-${pad(now.getSeconds())}.json`
      : `實驗日誌_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
          now.getDate()
        )}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(
          now.getSeconds()
        )}.json`;

    const blob = new Blob([logData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // 僅在 console 顯示
    Logger.info(`[LogPanel] 實驗日誌已自動匯出: ${fileName}`);
  }

  /**
   * 顯示日誌面板
   */
  showLoggerPanel() {
    if (this.loggerOutput) {
      this.loggerOutput.style.display = "flex";
    }
    this.loggerPanelMinimized = false;
    // FAB按鈕保持可見，不隱藏
    if (this.loggerFabButton) {
      this.loggerFabButton.style.display = "flex";
    }
    localStorage.setItem("loggerMinimized", "false");
  }

  /**
   * 隱藏日誌面板
   */
  hideLoggerPanel() {
    if (this.loggerOutput) {
      this.loggerOutput.style.display = "none";
    }
    if (this.loggerFabButton) {
      this.loggerFabButton.style.display = "flex";
    }
    this.loggerPanelMinimized = false;
    localStorage.setItem("loggerMinimized", "false");
  }

  /**
   * 最小化日誌面板
   */
  minimizeLogger() {
    if (this.loggerOutput) {
      this.loggerOutput.style.display = "none";
    }
    if (this.loggerFabButton) {
      this.loggerFabButton.style.display = "flex";
    }
    this.loggerPanelMinimized = true;
    localStorage.setItem("loggerMinimized", "true");
  }

  /**
   * 設定事件監聽器
   */
  setupEventListeners() {
    // 清空日誌按鈕
    const clearLogButton = document.getElementById("clearLogButton");
    if (clearLogButton) {
      clearLogButton.addEventListener("click", () => this.clearLog());
    }

    // 匯出日誌按鈕
    const exportLogButton = document.getElementById("exportLogButton");
    if (exportLogButton) {
      exportLogButton.addEventListener("click", () => this.exportLog());
    }

    // 統計按鈕
    const showStatsButton = document.getElementById("showStatsButton");
    if (showStatsButton) {
      showStatsButton.addEventListener("click", () => {
        const stats = this.displayStats();
        alert(`實驗日誌統計：
總記錄數: ${stats.total_entries}
實驗相關: ${stats.experiment_entries}
系統記錄: ${stats.system_entries}
組合按鈕: ${stats.combo_operations}
鍵盤操作: ${stats.keyboard_operations}
觸控操作: ${stats.touch_operations}
使用按鈕: ${stats.unique_buttons}
功能數量: ${stats.unique_functions}`);
      });
    }

    // 複製日誌按鈕
    const copyLogButton = document.getElementById("copyLogButton");
    if (copyLogButton) {
      copyLogButton.addEventListener("click", () => this.copyLog());
    }

    // 最小化按鈕
    const minimizeLoggerPanel = document.getElementById("minimizeLoggerPanel");
    if (minimizeLoggerPanel) {
      minimizeLoggerPanel.addEventListener("click", () =>
        this.minimizeLogger()
      );
    }

    // 關閉按鈕
    const closeLoggerPanel = document.getElementById("closeLoggerPanel");
    if (closeLoggerPanel) {
      closeLoggerPanel.addEventListener("click", () => this.hideLoggerPanel());
    }

    // FAB 按鈕
    if (this.loggerFabButton) {
      this.loggerFabButton.addEventListener("click", () => {
        // 智慧切換：如果面板顯示則最小化，如果隱藏則顯示
        if (this.loggerOutput.style.display === "flex") {
          this.minimizeLogger();
        } else {
          this.showLoggerPanel();
        }
      });
    }

    // 點擊外部關閉日誌面板
    this.setupOutsideClickListener();

    // 移除日誌開關相關代碼，因為已從 HTML 中移除
  }

  /**
   * 設定點擊外部關閉日誌面板的監聽器
   */
  setupOutsideClickListener() {
    document.addEventListener("click", (e) => {
      // 如果日誌面板沒有顯示，不處理
      if (!this.loggerOutput || this.loggerOutput.style.display !== "flex") {
        return;
      }

      // 檢查點擊是否在日誌面板內部
      const isClickInsidePanel = this.loggerOutput.contains(e.target);

      // 檢查點擊是否在 FAB 按鈕上
      const isClickOnFab =
        this.loggerFabButton && this.loggerFabButton.contains(e.target);

      // 如果點擊在面板外部且不是 FAB 按鈕，關閉面板
      if (!isClickInsidePanel && !isClickOnFab) {
        this.hideLoggerPanel();
      }
    });
  }

  /**
   * 設定日誌視窗位置
   */
  setupDragAndResize() {
    if (!this.loggerOutput) return;

    // 固定位置顯示
    this.loggerOutput.style.position = "fixed";
    this.loggerOutput.style.right = "20px";
    this.loggerOutput.style.bottom = "20px";
    this.loggerOutput.style.width = "300px";
    this.loggerOutput.style.height = "400px";

    // 新增標題列拖曳事件
    const loggerTitle = this.loggerOutput.querySelector(".logger-title");
    if (loggerTitle) {
      loggerTitle.addEventListener("mousedown", (e) => {
        this.dragState.isDragging = true;
        this.loggerOutput.classList.add("resizing");
        const transform = new DOMMatrix(
          window.getComputedStyle(this.loggerOutput).transform
        );
        this.dragState.initialX = e.clientX - transform.e;
        this.dragState.initialY = e.clientY - transform.f;
      });
    }

    document.addEventListener("mousemove", (e) => {
      if (this.dragState.isDragging) {
        e.preventDefault();
        this.dragState.currentX = e.clientX - this.dragState.initialX;
        this.dragState.currentY = e.clientY - this.dragState.initialY;
        this.loggerOutput.style.transform = `translate(${this.dragState.currentX}px, ${this.dragState.currentY}px)`;
      }
    });

    document.addEventListener("mouseup", () => {
      if (this.dragState.isDragging) {
        this.dragState.isDragging = false;
        this.loggerOutput.classList.remove("resizing");
        // 記錄位置
        localStorage.setItem(
          "loggerPosition",
          this.loggerOutput.style.transform
        );
      }
    });

    // 從 localStorage 還原位置和大小
    const savedTransform = localStorage.getItem("loggerPosition");
    if (savedTransform) {
      this.loggerOutput.style.transform = savedTransform;
    }

    const savedSize = localStorage.getItem("loggerSize");
    if (savedSize) {
      const { width, height } = JSON.parse(savedSize);
      this.loggerOutput.style.width = `${width}px`;
      this.loggerOutput.style.height = `${height}px`;
    }

    // 確保視窗在可視範圍內
    const rect = this.loggerOutput.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    if (rect.right > windowWidth) {
      this.loggerOutput.style.left = `${windowWidth - rect.width}px`;
    }
    if (rect.bottom > windowHeight) {
      this.loggerOutput.style.top = `${windowHeight - rect.height}px`;
    }
    if (rect.left < 0) {
      this.loggerOutput.style.left = "0px";
    }
    if (rect.top < 0) {
      this.loggerOutput.style.top = "0px";
    }
  }

  /**
   * 初始化日誌狀態
   */
  initializeLoggerState() {
    // 預設隱藏 logger panel，只顯示 FAB 按鈕
    this.hideLoggerPanel();

    // 偵測實驗模式並自動最小化
    setTimeout(() => {
      this.handleExperimentMode();
    }, 100);
  }

  /**
   * 更新目前步驟顯示
   */
  updateCurrentStepDisplay() {
    const currentStepDisplay = document.getElementById("currentStepDisplay");
    if (!currentStepDisplay) return;

    if (window.experiment && window.experiment.isExperimentRunning) {
      const unitId =
        window.experiment.loadedUnits[window.experiment.currentUnitIndex];
      const unit = window._allUnits
        ? window._allUnits.find((u) => u.unit_id === unitId)
        : null;
      const step =
        unit && unit.steps
          ? unit.steps[window.experiment.currentStepIndex]
          : null;

      if (step) {
        currentStepDisplay.textContent = `[${step.step_id || "未知步驟"}]`;
        currentStepDisplay.style.display = "inline";
      } else {
        currentStepDisplay.style.display = "none";
      }
    } else {
      currentStepDisplay.style.display = "none";
    }
  }

  /**
   * 清除步驟顯示
   */
  clearInteractionButtons() {
    const currentStepDisplay = document.getElementById("currentStepDisplay");
    if (currentStepDisplay) {
      currentStepDisplay.style.display = "none";
    }
  }
}

// 匯出單例
window.logger = new LogPanel();
