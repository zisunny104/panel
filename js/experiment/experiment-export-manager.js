// experiment-export-manager.js - 實驗統計管理模組

/**
 * 實驗統計管理器
 * 負責收集實驗資料並在頁面上視覺化呈現統計資訊
 */
class ExperimentExportManager {
  constructor(experimentPageManager) {
    this.app = experimentPageManager;
  }

  /**
   * 收集實驗統計資料用於頁面顯示
   */
  collectExperimentData() {
    return {
      experiment_metadata: {
        total_duration_ms: this.calculateTotalDuration(),
        gesture_count: this.app.currentCombination?.gestures?.length || 0,
        action_count: this.app.currentActionSequence?.length || 0,
      },
      gesture_statistics: this.generateGestureStatistics(),
      action_statistics: this.generateActionStatistics(),
    };
  }

  /**
   * 從日誌中取得實驗開始時間
   */
  getStartTime() {
    if (window.logger?.logEntries?.length > 0) {
      const startEntry = window.logger.logEntries.find(
        (entry) => entry.action_type === "experiment_started",
      );
      if (startEntry) {
        return startEntry.timestamp;
      }
    }
    return new Date().toISOString();
  }

  /**
   * 計算總花費時間（毫秒）
   */
  calculateTotalDuration() {
    if (!window.logger?.logEntries || window.logger.logEntries.length < 2)
      return 0;
    const startEntry = window.logger.logEntries.find(
      (entry) => entry.action_type === "experiment_started",
    );
    const endEntry = [...window.logger.logEntries]
      .reverse()
      .find((entry) => entry.action_type === "experiment_stopped");

    if (startEntry && endEntry) {
      return new Date(endEntry.timestamp) - new Date(startEntry.timestamp);
    }
    return 0;
  }

  /**
   * 產生手勢統計（用於頁面顯示）
   * @returns {Object} 手勢統計對象
   */
  generateGestureStatistics() {
    const gestureStats = {};

    // 從 app.gestureStats 收集統計資料
    if (
      this.app.gestureStats &&
      Object.keys(this.app.gestureStats).length > 0
    ) {
      for (const [gestureName, stats] of Object.entries(
        this.app.gestureStats,
      )) {
        const total = stats.planned || 0;
        const correct = stats.correct || 0;
        const uncertain = stats.uncertain || 0;
        const incorrect = stats.incorrect || 0;
        const completed = stats.completed || 0;

        gestureStats[gestureName] = {
          planned: total,
          completed: completed,
          correct: correct,
          uncertain: uncertain,
          incorrect: incorrect,
          accuracy_rate:
            total > 0 ? ((correct / total) * 100).toFixed(2) + "%" : "0%",
          completion_rate:
            total > 0 ? ((completed / total) * 100).toFixed(2) + "%" : "0%",
          concordance_rate:
            total > 0
              ? (((correct + uncertain) / total) * 100).toFixed(2) + "%"
              : "0%",
        };
      }
    }

    return gestureStats;
  }

  /**
   * 產生 Action 統計（如果有記錄的話）
   */
  generateActionStatistics() {
    const actionStats = {};

    // 從日誌中查找所有 action 相關的記錄
    if (window.logger?.logEntries) {
      window.logger.logEntries.forEach((entry) => {
        if (entry.action_type === "action_completed" && entry.additional_data) {
          const actionId =
            entry.additional_data.action_id || entry.additional_data.action;
          if (actionId) {
            if (!actionStats[actionId]) {
              actionStats[actionId] = {
                times: [],
                count: 0,
              };
            }
            actionStats[actionId].times.push({
              timestamp: entry.timestamp,
              duration: entry.additional_data.duration || null,
            });
            actionStats[actionId].count++;
          }
        }
      });

      // 計算平均耗時
      for (const [actionId, data] of Object.entries(actionStats)) {
        const durations = data.times
          .map((t) => t.duration)
          .filter((d) => d !== null && d !== undefined);
        if (durations.length > 0) {
          const avgDuration =
            durations.reduce((a, b) => a + b, 0) / durations.length;
          actionStats[actionId].avg_duration_ms = Math.round(avgDuration);
          actionStats[actionId].min_duration_ms = Math.min(...durations);
          actionStats[actionId].max_duration_ms = Math.max(...durations);
        }
      }
    }

    return actionStats;
  }

  /**
   * 在頁面上視覺化呈現統計資料
   */
  displayStatisticsOnPage() {
    const data = this.collectExperimentData();

    // 取得實驗統計區塊容器（位於左邊面板）
    let experimentStats = document.getElementById("experimentStats");
    if (!experimentStats) {
      return; // 如果沒有統計區塊，直接回傳
    }

    // 建立統計內容容器
    let statsPanel = document.getElementById("experimentStatsPanel");
    if (!statsPanel) {
      statsPanel = document.createElement("div");
      statsPanel.id = "experimentStatsPanel";
      experimentStats.appendChild(statsPanel);
    }

    // 構建統計內容
    let html = `
      <div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 2px solid #eee;">
        <h3 style="margin: 0 0 5px 0; color: #333; font-size: 14px;">實驗統計</h3>
        <div style="color: #666; font-size: 12px;">
          <div>花費時間: <strong>${this.formatDurationSimple(
            data.experiment_metadata.total_duration_ms,
          )}</strong></div>
          <div>手勢總數: <strong>${
            data.experiment_metadata.gesture_count
          }</strong></div>
          <div>Action總數: <strong>${
            data.experiment_metadata.action_count
          }</strong></div>
        </div>
      </div>
    `;

    // 手勢統計
    if (Object.keys(data.gesture_statistics).length > 0) {
      html += `
        <div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 2px solid #eee;">
          <h4 style="margin: 0 0 5px 0; color: #333; font-size: 13px;">手勢統計</h4>
      `;

      for (const [gestureName, stats] of Object.entries(
        data.gesture_statistics,
      )) {
        const accuracyNum = parseFloat(stats.accuracy_rate);
        const accuracyColor =
          accuracyNum >= 80
            ? "#4caf50"
            : accuracyNum >= 50
              ? "#ff9800"
              : "#f44336";

        html += `
          <div style="margin: 5px 0; padding: 5px; background: #f5f5f5; border-radius: 4px;">
            <div style="font-weight: 600; color: #333;">${gestureName}</div>
            <div style="font-size: 11px; color: #666; margin-top: 3px;">
              <div>正確: ${stats.correct}/${stats.planned}
                <span style="color: ${accuracyColor}; font-weight: 600;">${
                  stats.accuracy_rate
                }</span></div>
              <div>同意: ${stats.correct + stats.uncertain}/${stats.planned}
                <span style="color: #667eea; font-weight: 600;">${
                  stats.concordance_rate
                }</span></div>
              <div>✗ 錯誤: ${stats.incorrect} | 完成: ${stats.completed}</div>
            </div>
          </div>
        `;
      }

      html += `</div>`;
    }

    // Action 統計
    if (Object.keys(data.action_statistics).length > 0) {
      html += `
        <div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 2px solid #eee;">
          <h4 style="margin: 0 0 5px 0; color: #333; font-size: 13px;">Action 統計</h4>
      `;

      for (const [actionId, stats] of Object.entries(data.action_statistics)) {
        html += `
          <div style="margin: 5px 0; padding: 5px; background: #f5f5f5; border-radius: 4px;">
            <div style="font-weight: 600; color: #333;">${actionId}</div>
            <div style="font-size: 11px; color: #666; margin-top: 3px;">
              <div>執行次數: <strong>${stats.count}</strong></div>
              <div>平均耗時: <strong>${
                stats.avg_duration_ms || "N/A"
              }</strong> ms</div>
              <div>範圍: ${stats.min_duration_ms || "N/A"} - ${
                stats.max_duration_ms || "N/A"
              } ms</div>
            </div>
          </div>
        `;
      }

      html += `</div>`;
    }

    statsPanel.innerHTML = html;

    // 顯示實驗統計區塊
    experimentStats.style.display = "block";
  }

  /**
   * 格式化時間顯示（毫秒轉換為 mm:ss 格式）
   */
  formatDurationSimple(ms) {
    if (ms === 0 || !ms) return "00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
      2,
      "0",
    )}`;
  }
}

// 匯出模組
export { ExperimentExportManager };
