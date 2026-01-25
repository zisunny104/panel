/**
 * PanelExperimentLog - 機台面板專用實驗日誌（JSONL 格式）
 */

class PanelExperimentLog {
  constructor() {
    this.logs = [];
    this.startExperimentId = null;
    this.experimentStartTime = null;
    this.subjectName = null;
    this.combinationName = null;
    this.isRecording = false;
    this.syncDevices = new Map();
    this.waitingForSyncDevices = false;
  }

  /**
   * 開始記錄實驗
   * @param {string} experimentId - 實驗 ID
   * @param {string} subjectName - 受試者名稱
   * @param {string} combinationName - 組合名稱
   */
  startRecording(experimentId, subjectName = "", combinationName = "") {
    // 儲存開始實驗時的 ID（這個 ID 不會改變）
    this.startExperimentId = experimentId;
    this.subjectName = subjectName || `受試者_${experimentId}`;
    this.combinationName = combinationName;
    this.experimentStartTime = Date.now();
    this.isRecording = true;
    this.logs = [];
    this.syncDevices.clear();

    // 記錄實驗開始事件
    this._addLog({
      type: "experiment_start",
      experiment_id: experimentId,
      subject_name: this.subjectName,
      combination: combinationName,
      device: "panel"
    });

    // console.log(
    //   `[PanelExperimentLog] 開始記錄 - ID: ${experimentId}, 受試者: ${this.participantName}`
    // );
  }

  /**
   * 記錄動作完成
   * @param {string} actionId - 動作 ID
   * @param {string} actionName - 動作名稱
   * @param {string} buttonId - 按鈕 ID
   * @param {string} functionName - 功能名稱
   * @param {number} actionIndex - 動作索引
   * @param {number} totalActions - 總動作數
   */
  logActionComplete(
    actionId,
    actionName,
    buttonId,
    functionName,
    actionIndex,
    totalActions
  ) {
    if (!this.isRecording) return;

    this._addLog({
      type: "action_complete",
      action_id: actionId,
      action_name: actionName,
      button_id: buttonId,
      function_name: functionName,
      action_index: actionIndex,
      total_actions: totalActions
    });
  }

  /**
   * 記錄步驟變更（單元內的步驟）
   * @param {string} unitId - 單元 ID
   * @param {number} stepIndex - 步驟索引
   * @param {string} stepId - 步驟 ID
   */
  logStepChange(unitId, stepIndex, stepId) {
    if (!this.isRecording) return;

    this._addLog({
      type: "step_change",
      unit_id: unitId,
      step_index: stepIndex,
      step_id: stepId
    });
  }

  /**
   * 記錄單元變更
   * @param {string} unitId - 單元 ID
   * @param {number} unitIndex - 單元索引
   * @param {number} totalUnits - 總單元數
   */
  logUnitChange(unitId, unitIndex, totalUnits) {
    if (!this.isRecording) return;

    this._addLog({
      type: "unit_change",
      unit_id: unitId,
      unit_index: unitIndex,
      total_units: totalUnits
    });
  }

  /**
   * 記錄按鈕點擊（包含正確/錯誤）
   * @param {string} buttonId - 按鈕 ID
   * @param {string} functionName - 功能名稱
   * @param {boolean} isCorrect - 是否正確
   * @param {string} expectedButton - 預期的按鈕（如果錯誤）
   */
  logButtonClick(buttonId, functionName, isCorrect, expectedButton = null) {
    if (!this.isRecording) return;

    const logEntry = {
      type: "button_click",
      button_id: buttonId,
      function_name: functionName,
      is_correct: isCorrect
    };

    if (!isCorrect && expectedButton) {
      logEntry.expected_button = expectedButton;
    }

    this._addLog(logEntry);
  }

  /**
   * 記錄電源狀態變更
   * @param {boolean} isPowerOn - 是否開機
   * @param {string} reason - 原因
   */
  logPowerChange(isPowerOn, reason = "") {
    if (!this.isRecording) return;

    this._addLog({
      type: "power_change",
      is_power_on: isPowerOn,
      reason: reason
    });
  }

  /**
   * 記錄實驗暫停
   */
  logPause() {
    if (!this.isRecording) return;

    this._addLog({
      type: "experiment_pause"
    });
  }

  /**
   * 記錄實驗還原
   */
  logResume() {
    if (!this.isRecording) return;

    this._addLog({
      type: "experiment_resume"
    });
  }

  /**
   * 記錄同步裝置連線
   * @param {string} deviceId - 裝置 ID
   * @param {string} deviceType - 裝置類型
   */
  logSyncDeviceConnected(deviceId, deviceType) {
    if (!this.isRecording) return;

    this.syncDevices.set(deviceId, {
      connected: true,
      experimentCompleted: false,
      type: deviceType
    });

    this._addLog({
      type: "sync_device_connected",
      device_id: deviceId,
      device_type: deviceType
    });
  }

  /**
   * 記錄同步裝置斷開
   * @param {string} deviceId - 裝置 ID
   */
  logSyncDeviceDisconnected(deviceId) {
    if (!this.isRecording) return;

    if (this.syncDevices.has(deviceId)) {
      this.syncDevices.get(deviceId).connected = false;
    }

    this._addLog({
      type: "sync_device_disconnected",
      device_id: deviceId
    });
  }

  /**
   * 標記同步裝置已完成實驗
   * @param {string} deviceId - 裝置 ID
   */
  markSyncDeviceCompleted(deviceId) {
    if (this.syncDevices.has(deviceId)) {
      this.syncDevices.get(deviceId).experimentCompleted = true;
      Logger.info(`[PanelExperimentLog] 同步裝置 ${deviceId} 已完成實驗`);
    }

    // 檢查是否所有同步裝置都已完成
    this._checkAllDevicesCompleted();
  }

  /**
   * 結束記錄並下載 JSONL
   * @param {number} totalElapsedSeconds - 總耗時（秒）
   * @param {boolean} isAutoStop - 是否為自動停止
   * @returns {Promise<boolean>} - 是否成功
   */
  async stopRecording(totalElapsedSeconds = 0, isAutoStop = false) {
    if (!this.isRecording) {
      Logger.warn("[PanelExperimentLog] 尚未開始記錄");
      return false;
    }

    // 記錄實驗結束事件
    this._addLog({
      type: "experiment_end",
      experiment_id: this.startExperimentId,
      total_elapsed_seconds: totalElapsedSeconds,
      is_auto_stop: isAutoStop,
      total_logs: this.logs.length
    });

    this.isRecording = false;

    // 如果有同步裝置且是自動停止，等待所有裝置完成
    if (isAutoStop && this.syncDevices.size > 0) {
      const allCompleted = this._areAllSyncDevicesCompleted();
      if (!allCompleted) {
        // console.log(
        //   "[PanelExperimentLog] 等待同步裝置完成實驗後再更新實驗 ID..."
        // );
        this.waitingForSyncDevices = true;
        // 先下載日誌，但不更新實驗 ID
        this._downloadJSONL();
        return true; // 回傳 true 但不更新 ID
      }
    }

    // 下載 JSONL 檔案
    this._downloadJSONL();

    // console.log(
    //   `[PanelExperimentLog] 記錄結束 - 共 ${this.logs.length} 條日誌`
    // );

    return true;
  }

  /**
   * 檢查是否可以更新實驗 ID（所有同步裝置都已完成）
   * @returns {boolean}
   */
  canUpdateExperimentId() {
    if (!this.waitingForSyncDevices) {
      return true;
    }

    return this._areAllSyncDevicesCompleted();
  }

  /**
   * 確認可以更新實驗 ID（在所有同步裝置完成後呼叫）
   */
  confirmExperimentIdUpdate() {
    this.waitingForSyncDevices = false;
    //console.log("[PanelExperimentLog] 所有同步裝置已完成，可以更新實驗 ID");
  }

  /**
   * 取得開始實驗時的 ID
   * @returns {string|null}
   */
  getStartExperimentId() {
    return this.startExperimentId;
  }

  /**
   * 取得所有日誌
   * @returns {Array}
   */
  getLogs() {
    return [...this.logs];
  }

  /**
   * 取得 JSONL 格式的日誌
   * @returns {string}
   */
  getLogsAsJSONL() {
    return this.logs.map((log) => JSON.stringify(log)).join("\n");
  }

  /**
   * 內部方法：新增日誌條目
   * @private
   */
  _addLog(entry) {
    const logEntry = {
      ts: Date.now(),
      ...entry
    };
    this.logs.push(logEntry);
  }

  /**
   * 內部方法：下載 JSONL 檔案
   * @private
   */
  _downloadJSONL() {
    if (this.logs.length === 0) {
      Logger.warn("[PanelExperimentLog] 沒有日誌可下載");
      return;
    }

    const jsonlContent = this.getLogsAsJSONL();
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, "0");

    // 使用開始實驗時的 ID 作為檔案名稱
    const fileName = `panel_exp_${
      this.startExperimentId
    }_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate()
    )}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(
      now.getSeconds()
    )}.jsonl`;

    const blob = new Blob([jsonlContent], { type: "application/jsonl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // console.log(`[PanelExperimentLog] JSONL 日誌已下載: ${fileName}`);
  }

  /**
   * 內部方法：檢查所有同步裝置是否已完成
   * @private
   * @returns {boolean}
   */
  _areAllSyncDevicesCompleted() {
    if (this.syncDevices.size === 0) {
      return true;
    }

    for (const [_deviceId, status] of this.syncDevices) {
      // 只檢查還連線著的裝置
      if (status.connected && !status.experimentCompleted) {
        return false;
      }
    }

    return true;
  }

  /**
   * 內部方法：檢查所有裝置是否已完成，如果是則觸發事件
   * @private
   */
  _checkAllDevicesCompleted() {
    if (this.waitingForSyncDevices && this._areAllSyncDevicesCompleted()) {
      this.confirmExperimentIdUpdate();

      // 觸發事件通知可以更新實驗 ID
      document.dispatchEvent(
        new CustomEvent("panelExperimentLog:allDevicesCompleted", {
          detail: {
            experimentId: this.startExperimentId
          }
        })
      );
    }
  }

  /**
   * 重設日誌管理器
   */
  reset() {
    this.logs = [];
    this.startExperimentId = null;
    this.experimentStartTime = null;
    this.participantName = null;
    this.combinationName = null;
    this.isRecording = false;
    this.syncDevices.clear();
    this.waitingForSyncDevices = false;
    //console.log("[PanelExperimentLog] 已重設");
  }
}

// 全域暴露
window.PanelExperimentLog = PanelExperimentLog;
window.panelExperimentLog = new PanelExperimentLog();
