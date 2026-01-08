/**
 * Panel Experiment Sync Receiver - 虛擬面板實驗同步接收器
 * 在 index.html 的虛擬面板中接收並展示來自 experiment.html 的實驗狀態
 * 用於在同個工作階段中多裝置協作
 */

class PanelExperimentSyncReceiver {
  constructor() {
    this.isConnected = false;
    this.remoteExperimentRunning = false;
    this.remoteExperimentPaused = false;
    this.remoteDeviceId = null;
    this.initialize();
  }

  /**
   * 初始化同步接收器
   */
  initialize() {
    // 監聽同步連線狀態
    window.addEventListener("sync_session_joined", () => {
      this.isConnected = true;
    });

    window.addEventListener("sync_session_left", () => {
      this.isConnected = false;
      this.remoteExperimentRunning = false;
      this.remoteExperimentPaused = false;
    });

    // 監聽遠端實驗狀態變化
    document.addEventListener("remote_experiment_started", (event) => {
      this.handleRemoteExperimentStart(event.detail);
    });

    document.addEventListener("remote_experiment_paused", (event) => {
      this.handleRemoteExperimentPause(event.detail);
    });

    document.addEventListener("remote_experiment_resumed", (event) => {
      this.handleRemoteExperimentResume(event.detail);
    });

    document.addEventListener("remote_experiment_stopped", (event) => {
      this.handleRemoteExperimentStop(event.detail);
    });

    // 監聽遠端操作
    document.addEventListener("remote_experiment_action", (event) => {
      this.handleRemoteExperimentAction(event.detail);
    });

    // 監聽遠端組合選擇
    document.addEventListener("remote_combination_selected", (event) => {
      this.handleRemoteCombinationSelected(event.detail);
    });

    // 監聽設定面板的同步指示器顯示開關已移除
  }

  /**
   * 處理遠端實驗開始
   */
  handleRemoteExperimentStart(detail) {
    this.remoteExperimentRunning = true;
    this.remoteExperimentPaused = false;
    this.remoteDeviceId = detail.remote_device_id;

    // 可選：在虛擬面板上顯示提示
    this.showSyncNotification("實驗已在遠端開始", "info");
  }

  /**
   * 處理遠端實驗暫停
   */
  handleRemoteExperimentPause(detail) {
    this.remoteExperimentPaused = true;
    this.showSyncNotification("實驗已暫停", "warning");
  }

  /**
   * 處理遠端實驗還原
   */
  handleRemoteExperimentResume(detail) {
    this.remoteExperimentPaused = false;
    this.showSyncNotification("實驗已還原", "info");
  }

  /**
   * 處理遠端實驗停止
   */
  handleRemoteExperimentStop(detail) {
    this.remoteExperimentRunning = false;
    this.remoteExperimentPaused = false;
    this.remoteDeviceId = null;
    this.showSyncNotification("實驗已停止", "info");
  }

  /**
   * 處理遠端實驗操作
   */
  handleRemoteExperimentAction(detail) {
    // 可在這裡記錄或展示遠端操作
    // 例如：在虛擬面板上高亮顯示被遠端按下的按鈕
  }

  /**
   * 處理遠端組合選擇
   */
  handleRemoteCombinationSelected(detail) {
    const { combination } = detail;

    Logger.info(
      "[PanelExperimentSyncReceiver] 接收到遠端組合選擇:",
      combination
    );

    // 使用中央 CombinationSelector 套用遠端選擇
    if (window.CombinationSelector) {
      window.CombinationSelector.selectCombination(combination);
      this.showSyncNotification(
        `已同步組合：${combination.combination_name}`,
        "success"
      );
    } else {
      Logger.warn(
        "[PanelExperimentSyncReceiver] CombinationSelector 未載入，無法套用遠端組合選擇"
      );
    }
  }

  /**
   * 顯示同步通知
   */
  showSyncNotification(message, type = "info") {
    // 可選實作：顯示臨時通知
    // 目前只記錄到控制台
  }

  /**
   * 取得同步狀態
   */
  getStatus() {
    return {
      connected: this.isConnected,
      remoteExperimentRunning: this.remoteExperimentRunning,
      remoteExperimentPaused: this.remoteExperimentPaused,
      remoteDeviceId: this.remoteDeviceId,
    };
  }
}

// 初始化全域實例
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    window.panelExperimentSyncReceiver = new PanelExperimentSyncReceiver();
  });
} else {
  window.panelExperimentSyncReceiver = new PanelExperimentSyncReceiver();
}
