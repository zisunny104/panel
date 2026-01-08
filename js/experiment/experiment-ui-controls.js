// experiment-ui-controls.js - 實驗頁面 UI 控制模組

/**
 * 切換左側面板的展開或收起狀態
 */
const toggleLeftPanel = function () {
  const leftPanel = document.querySelector(".left-panel");
  const toggleBtn = document.getElementById("panelToggleBtn");

  leftPanel.classList.toggle("collapsed");
  toggleBtn.classList.toggle("collapsed");
};

// 暴露至全域供 HTML 調用
window.toggleLeftPanel = toggleLeftPanel;

/**
 * 切換手勢統計詳細資訊的顯示或隱藏
 */
const toggleGestureStats = function () {
  const detail = document.getElementById("gestureStatsDetail");
  const toggle = document.getElementById("gestureStatsToggle");

  if (detail.style.display === "none") {
    detail.style.display = "block";
    toggle.style.transform = "rotate(180deg)";
  } else {
    detail.style.display = "none";
    toggle.style.transform = "rotate(0deg)";
  }
};

// 暴露至全域供 HTML 調用
window.toggleGestureStats = toggleGestureStats;

//匯出ES6模組
export { toggleLeftPanel, toggleGestureStats };
