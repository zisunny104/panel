/**
 * Panel Sync Operator
 * 面板同步操作者控制
 * 允許面板作為同步操作者控制實驗的開始/停止
 */

class PanelSyncOperator {
  constructor() {
    this.experimentRunning = false;
    this.syncControlsEnabled = false;
    this.deviceId = this.getDeviceId();
    this.initialize();
  }

  /**
   * 取得或產生裝置 ID
   */
  getDeviceId() {
    let deviceId = localStorage.getItem("sync_device_id");
    if (!deviceId) {
      // 產生新的裝置 ID（基於 clientId）
      if (window.syncManager?.core?.syncClient?.clientId) {
        deviceId = window.syncManager.core.syncClient.clientId;
      } else {
        // 備用：自己產生
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        deviceId = `PANEL-${timestamp}-${random}`.toUpperCase();
      }
      localStorage.setItem("sync_device_id", deviceId);
    }
    return deviceId;
  }

  /**
   * 初始化面板同步操作者控制
   */
  initialize() {
    // 監聽連線狀態變化
    window.addEventListener("sync_session_joined", () => {
      this.updateSyncControls();
    });

    // 監聽同步狀態更新
    window.addEventListener("sync_state_update", (event) => {
      const state = event.detail;
      if (state && state.type === "experiment_started") {
        this.handleRemoteExperimentStart(state);
      } else if (state && state.type === "experiment_stopped") {
        this.handleRemoteExperimentStop(state);
      }
      // 注意：按鈕動作已改用 button_action，透過 panel-experiment-manager 處理
    });

    // 監聽本機按鈕按下事件（來自 button-manager）
    // 注意：按鈕同步已改由 panel-experiment-manager.broadcastButtonAction() 處理
    // 此處只保留本機日誌記錄
    document.addEventListener("buttonPressed", (event) => {
      if (this.experimentRunning && this.syncControlsEnabled) {
        // 記錄到實驗日誌
        if (
          window.experimentLogManager &&
          event.detail &&
          event.detail.action_id
        ) {
          window.experimentLogManager.logAction(event.detail.action_id);
        }
      }
    });

    // 建立實驗控制面板
    this.createExperimentControls();
    this.updateSyncControls();
  }

  /**
   * 建立面板上的實驗控制 UI
   */
  createExperimentControls() {
    // 檢查是否已存在
    if (document.getElementById("panelSyncOperatorControls")) {
      return;
    }

    const controlsDiv = document.createElement("div");
    controlsDiv.id = "panelSyncOperatorControls";

    controlsDiv.innerHTML = `
      <div>
        裝置 ID: <span id="psoDeviceId"></span>
      </div>
      <div>
        <button id="psoStartBtn">開始實驗</button>
        <button id="psoStopBtn">停止實驗</button>
      </div>
      <div id="psoStatus"></div>
    `;

    document.body.appendChild(controlsDiv);

    // 綁定按鈕事件
    document.getElementById("psoStartBtn").addEventListener("click", () => {
      this.startExperimentFromPanel();
    });

    document.getElementById("psoStopBtn").addEventListener("click", () => {
      this.stopExperimentFromPanel();
    });

    // 更新裝置 ID 顯示
    document.getElementById("psoDeviceId").textContent = this.deviceId;
  }

  /**
   * 更新同步控制的可見性
   */
  updateSyncControls() {
    const role = window.syncManager?.core?.getRole?.();
    const isConnected = window.syncManager?.core?.isConnected?.();

    const controlsDiv = document.getElementById("panelSyncOperatorControls");
    if (!controlsDiv) return;

    // 只有在同步操作角色且已連線時才顯示
    if (isConnected && role === "operator") {
      controlsDiv.style.display = "block";
      this.syncControlsEnabled = true;
    } else {
      controlsDiv.style.display = "none";
      this.syncControlsEnabled = false;
    }
  }

  /**
   * 面板開始實驗
   */
  async startExperimentFromPanel() {
    if (this.experimentRunning) {
      Logger.warn("[PanelSyncOp] 實驗已在進行中");
      return;
    }

    // 檢查是否可以同步操作
    if (!this.syncControlsEnabled) {
      Logger.warn("[PanelSyncOp] 無法同步操作實驗");
      return;
    }

    // 如果有多個同步操作的面板，要求確認
    const connectedOperators = await this.checkMultipleOperators();
    if (connectedOperators > 1) {
      const confirmed = confirm(
        `偵測到 ${connectedOperators} 個同步操作面板。\n確認要由此裝置開始實驗嗎？\n(裝置 ID: ${this.deviceId})`
      );
      if (!confirmed) {
        this.updateStatus("操作已取消");
        return;
      }
    }

    // 設定實驗執行狀態
    this.experimentRunning = true;
    this.updateExperimentUI();
    this.updateStatus("正在同步實驗開始...");

    try {
      // 從 PanelExperimentManager 讀取實驗資料
      const experimentManager = window.panelExperiment;
      const subjectNameInput = document.getElementById("subjectNameInput");
      const subjectName = subjectNameInput ? subjectNameInput.value.trim() : "";

      // 構建完整的同步資料（包含手勢序列）
      const syncData = {
        type: "experiment_started",
        source: "panel",
        device_id: this.deviceId,
        experiment_id: experimentManager?.getCurrentExperimentId?.() || null,
        subject_name: subjectName,
        combination_id:
          experimentManager?.currentCombination?.combination_id || null,
        combination_name:
          experimentManager?.currentCombination?.combination_name || "未知組合",
        gesture_sequence: experimentManager?.currentCombination?.gestures || [],
        unit_count: experimentManager?.loadedUnits?.length || 0,
        gesture_count:
          experimentManager?.currentCombination?.gestures?.length || 0,
        timestamp: new Date().toISOString(),
      };

      Logger.info("[PanelSyncOp] 準備發送實驗開始資料:", {
        experimentId: syncData.experimentId,
        gestureCount: syncData.gestureCount,
        hasGestureSequence: syncData.gestureSequence.length > 0,
      });

      // 發送同步狀態
      await window.syncManager.core.syncState(syncData);

      this.updateStatus("實驗已開始（已同步）");
      Logger.info("[PanelSyncOp] 面板已開始實驗並同步");

      // 5 秒後清空狀態訊息
      setTimeout(() => {
        if (this.experimentRunning) {
          this.updateStatus("");
        }
      }, 5000);
    } catch (error) {
      Logger.error("[PanelSyncOp] 同步實驗開始失敗:", error);
      this.updateStatus("同步失敗: " + error.message);
      this.experimentRunning = false;
      this.updateExperimentUI();
    }
  }

  /**
   * 面板停止實驗
   */
  async stopExperimentFromPanel() {
    if (!this.experimentRunning) {
      Logger.warn("[PanelSyncOp] 實驗未在進行中");
      return;
    }

    if (!this.syncControlsEnabled) {
      Logger.warn("[PanelSyncOp] 無法同步操作實驗");
      return;
    }

    this.experimentRunning = false;
    this.updateExperimentUI();
    this.updateStatus("正在同步實驗停止...");

    try {
      const syncData = {
        type: "experiment_stopped",
        source: "panel",
        device_id: this.deviceId,
        timestamp: new Date().toISOString(),
      };

      await window.syncManager.core.syncState(syncData);

      this.updateStatus("實驗已停止（已同步）");
      Logger.info("[PanelSyncOp] 面板已停止實驗並同步:", syncData);

      setTimeout(() => {
        this.updateStatus("");
      }, 5000);
    } catch (error) {
      Logger.error("[PanelSyncOp] 同步實驗停止失敗:", error);
      this.updateStatus("同步失敗: " + error.message);
      this.experimentRunning = true;
      this.updateExperimentUI();
    }
  }

  /**
   * 檢查是否有多個同步操作的面板
   * 通過查詢連線的客戶端列表
   */
  async checkMultipleOperators() {
    try {
      // 如果 sync manager 有客戶端列表資訊
      if (window.syncManager?.core?.connectedClients) {
        const clients = window.syncManager.core.connectedClients;
        // 計數操作者角色的客戶端
        const operatorCount = Object.values(clients).filter(
          (client) => client.role === "operator"
        ).length;
        return operatorCount;
      }

      // 備用：通過 API 查詢
      if (window.syncManager?.core?.syncClient?.sessionId) {
        const sessionId = window.syncManager.core.syncClient.sessionId;
        try {
          const response = await fetch(
            `http://localhost:7645/api/sync/session/${sessionId}/clients`
          );

          if (response.ok) {
            const data = await response.json();
            if (data.clients && Array.isArray(data.clients)) {
              return data.clients.filter((c) => c.role === "operator").length;
            }
          }
        } catch (err) {
          Logger.warn("[PanelSyncOp] 無法查詢操作者數量:", err);
        }
      }

      // 預設回傳 1（表示只有目前操作者）
      return 1;
    } catch (error) {
      Logger.warn("[PanelSyncOp] 檢查操作者數量失敗:", error);
      return 1;
    }
  }

  /**
   * 更新實驗 UI 按鈕狀態
   */
  updateExperimentUI() {
    const startBtn = document.getElementById("psoStartBtn");
    const stopBtn = document.getElementById("psoStopBtn");

    if (!startBtn || !stopBtn) return;

    if (this.experimentRunning) {
      startBtn.style.display = "none";
      stopBtn.style.display = "block";
    } else {
      startBtn.style.display = "block";
      stopBtn.style.display = "none";
    }
  }

  /**
   * 更新狀態訊息
   */
  updateStatus(message) {
    const statusEl = document.getElementById("psoStatus");
    if (statusEl) {
      statusEl.textContent = message;
    }
  }

  /**
   * 處理來自其他裝置的實驗開始
   */
  handleRemoteExperimentStart(syncData) {
    Logger.info("[PanelSyncOp] 接收到遠端實驗開始:", syncData);

    // 如果來自其他裝置，只做狀態更新
    if (syncData.device_id !== this.deviceId) {
      Logger.info(`[PanelSyncOp] 實驗由裝置 ${syncData.device_id} 開始`);
      this.updateStatus(`已同步開始 (${syncData.device_id})`);
    }
  }

  /**
   * 處理來自其他裝置的實驗停止
   */
  handleRemoteExperimentStop(syncData) {
    Logger.info("[PanelSyncOp] 接收到遠端實驗停止:", syncData);

    // 如果來自其他裝置，更新狀態
    if (syncData.device_id !== this.deviceId) {
      Logger.info(`[PanelSyncOp] 實驗由裝置 ${syncData.device_id} 停止`);
      this.updateStatus(`已同步停止 (${syncData.device_id})`);
    }
  }

  /**
   * [已移除] syncPanelAction - 改用 panel-experiment-manager.broadcastButtonAction()
   * [已移除] handleRemotePanelAction - 統一使用 button_action 事件
   *
   * 按鈕動作同步流程已統一為：
   * buttonPressed 事件 → panel-experiment-manager.broadcastButtonAction()
   * → button_action 事件 → WebSocket 廣播
   */
}

// 初始化
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    window.panelSyncOperator = new PanelSyncOperator();
  });
} else {
  window.panelSyncOperator = new PanelSyncOperator();
}
