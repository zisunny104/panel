/**
 * BoardExportManager - 統計匯出管理器
 * 負責顯示實驗統計信息
 */
class BoardExportManager {
  constructor(boardPageManager) {
    this.boardPageManager = boardPageManager;
  }

  /**
   * 在頁面上顯示統計信息
   */
  displayStatisticsOnPage() {
    // 建立或更新統計面板
    let statsPanel = document.getElementById("experiment-stats-panel");
    if (!statsPanel) {
      statsPanel = document.createElement("div");
      statsPanel.id = "experiment-stats-panel";
      statsPanel.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 15px;
        border-radius: 8px;
        z-index: 1000;
        max-width: 300px;
        font-family: monospace;
        font-size: 12px;
      `;
      document.body.appendChild(statsPanel);
    }

    // 取得統計數據
    const stats = this.getExperimentStatistics();

    // 更新顯示
    statsPanel.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 10px;">📊 實驗統計</div>
      <div>實驗ID: ${stats.experimentId || "未設定"}</div>
      <div>受試者: ${stats.subjectName || "未設定"}</div>
      <div>組合: ${stats.combinationName || "未設定"}</div>
      <div>總動作數: ${stats.totalActions || 0}</div>
      <div>完成動作: ${stats.completedActions || 0}</div>
      <div>進行時間: ${stats.duration || "00:00:00"}</div>
    `;

    // 5秒後自動隱藏
    setTimeout(() => {
      if (statsPanel && statsPanel.parentNode) {
        statsPanel.remove();
      }
    }, 5000);
  }

  /**
   * 取得實驗統計數據
   */
  getExperimentStatistics() {
    const manager = this.boardPageManager;

    return {
      experimentId: manager.experimentId || null,
      subjectName: manager.subjectName || null,
      combinationName: manager.currentCombination?.combinationName || null,
      totalActions: manager.currentCombination?.units?.length || 0,
      completedActions: manager.completedActions?.size || 0,
      duration: manager.experimentStartTime
        ? this.formatDuration(Date.now() - manager.experimentStartTime)
        : "00:00:00",
    };
  }

  /**
   * 格式化持續時間
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    return `${hours.toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  }
}

// 導出到全域
if (typeof window !== "undefined") {
  window.BoardExportManager = BoardExportManager;
}
