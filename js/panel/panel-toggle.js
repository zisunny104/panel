// panel-toggle.js - 左邊面板收起/展開控制

/**
 * 切換左邊面板的顯示/隱藏
 */
function toggleLeftPanel() {
    const leftPanel = document.querySelector('.left-panel');
    const toggleBtn = document.getElementById('panelToggleBtn');

    leftPanel.classList.toggle('collapsed');
    toggleBtn.classList.toggle('collapsed');
}
