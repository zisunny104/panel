/**
 * Sync Confirm Dialog Manager - 多頁面統一確認窗口管理
 * 用途：在任何HTML頁面（index.html, experiment.html, procedure.html）中
 * 顯示統一樣式的加入同步工作階段確認窗口
 */

class SyncConfirmDialogManager {
  /**
   * 顯示加入工作階段確認對話框
   * @param {string} code - 分享代碼
   * @param {string} role - 'viewer' 或 'operator'
   * @param {Function} onConfirm - 確認時的Callback
   * @param {Function} onCancel - 取消時的Callback
   */
  static showJoinConfirmation(code, role, onConfirm, onCancel) {
    Logger.debug("showJoinConfirmation 被調用", { code, role });

    let selectedRole = role;
    let editedCode = code;
    const originalCode = code; // 記錄原始代碼用於還原

    // 移除已存在的對話框（避免重複）
    const existing = document.querySelector(".sync-confirm-dialog");
    if (existing) {
      Logger.debug("移除已存在的對話框");
      existing.remove();
    }

    Logger.debug("建立新的確認對話框");

    // 建立對話框
    const confirmDialog = document.createElement("div");
    confirmDialog.className = "modal-overlay sync-confirm-dialog";
    confirmDialog.innerHTML = `
      <div class="modal-container">
        <div class="modal-header">
          <h2 class="modal-title">加入同步工作階段</h2>
          <button class="modal-close-btn" title="關閉">×</button>
        </div>
        <div class="modal-body">
            <p class="sync-confirm-subtitle">請確認要加入以下工作階段</p>
            <div class="sync-confirm-items">
              <div class="sync-confirm-item">
                <div class="sync-confirm-label-row">
                  <span class="sync-confirm-label">分享代碼</span>
                  <div class="sync-confirm-checksum-status">
                    <span class="sync-confirm-checksum-icon">🔍</span>
                    <span class="sync-confirm-checksum-text">驗證中...</span>
                  </div>
                </div>
                <div class="sync-confirm-code-container">
                  <input type="text" class="sync-confirm-code-input" value="${code}" maxlength="10" />
                  <button class="sync-confirm-code-reset btn-secondary" title="還原分享代碼">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                      <path d="M21 3v5h-5"></path>
                      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                      <path d="M3 21v-5h5"></path>
                    </svg>
                  </button>
                </div>
              </div>
              <div class="sync-confirm-item">
                <span class="sync-confirm-label">模式</span>
                <div class="sync-confirm-mode-selector">
                  <button class="sync-confirm-mode-btn" data-role="${window.SyncManager?.ROLE?.VIEWER}">檢視模式</button>
                  <button class="sync-confirm-mode-btn" data-role="${window.SyncManager?.ROLE?.OPERATOR}">同步操作</button>
                </div>
              </div>
            </div>
        </div>
        <div class="modal-footer">
          <button class="sync-confirm-btn sync-confirm-btn-cancel modal-btn modal-btn-secondary">取消</button>
          <button class="sync-confirm-btn sync-confirm-btn-confirm modal-btn modal-btn-primary">確認加入</button>
        </div>
      </div>
    `;

    Logger.debug("將對話框新增到DOM");
    document.body.appendChild(confirmDialog);
    Logger.debug("對話框已新增到DOM，準備綁定事件");

    // 新增active類別以顯示對話框
    setTimeout(() => {
      confirmDialog.classList.add("active");
      Logger.debug("對話框active類別已新增，應該可見");
    }, 10);

    // 綁定事件
    const btnConfirm = confirmDialog.querySelector(".sync-confirm-btn-confirm");
    const btnCancel = confirmDialog.querySelector(".sync-confirm-btn-cancel");
    const btnClose = confirmDialog.querySelector(".modal-close-btn");
    const overlay = confirmDialog; // confirmDialog itself is the overlay
    const modeButtons = confirmDialog.querySelectorAll(
      ".sync-confirm-mode-btn"
    );
    const codeInput = confirmDialog.querySelector(".sync-confirm-code-input");
    const resetBtn = confirmDialog.querySelector(".sync-confirm-code-reset");

    // 設定初始模式按鈕
    const defaultBtn = confirmDialog.querySelector(`[data-role="${role}"]`);
    if (defaultBtn) {
      defaultBtn.classList.add("sync-confirm-mode-active");
    }

    // 分享代碼輸入變化 - 包含即時驗證狀態顯示
    let validationTimeout;
    codeInput.addEventListener("input", (e) => {
      Logger.debug("分享代碼輸入事件觸發，輸入值:", e.target.value);
      editedCode = e.target.value.toUpperCase();
      codeInput.value = editedCode;

      // 清除之前的驗證定時器
      clearTimeout(validationTimeout);

      // 取得驗證狀態顯示區域
      const statusEl = confirmDialog.querySelector(
        ".sync-confirm-checksum-status"
      );

      // 如果代碼為空，隱藏驗證狀態
      if (!editedCode.trim()) {
        statusEl.style.display = "none";
        return;
      }

      // 顯示驗證中的狀態
      statusEl.style.display = "flex";
      statusEl.classList.remove("valid", "invalid");
      statusEl.querySelector(".sync-confirm-checksum-icon").textContent = "🔍";
      statusEl.querySelector(".sync-confirm-checksum-text").textContent =
        "驗證中...";

      // 延遲驗證（避免頻繁請求）
      validationTimeout = setTimeout(async () => {
        Logger.debug("開始驗證分享代碼:", editedCode);
        try {
          // 使用 SyncClient 的方法驗證
          const syncClient = window.syncManager?.core?.syncClient;
          if (!syncClient) {
            throw new Error("SyncClient 未初始化");
          }

          const result = await syncClient.getShareCodeInfo(editedCode);
          Logger.debug("收到驗證回應:", result);

          // 確保元素仍存在且對話框未關閉
          const currentStatus = confirmDialog.querySelector(
            ".sync-confirm-checksum-status"
          );
          if (!currentStatus) return;

          // 有結果且未過期、未使用
          if (result && !result.expired && !result.used) {
            Logger.debug("分享代碼驗證成功");
            currentStatus.classList.add("valid");
            currentStatus.classList.remove("invalid");
            currentStatus.querySelector(
              ".sync-confirm-checksum-icon"
            ).textContent = "有效";
            currentStatus.querySelector(
              ".sync-confirm-checksum-text"
            ).textContent = "代碼有效";
          } else {
            Logger.debug("分享代碼驗證失敗:", result);
            currentStatus.classList.add("invalid");
            currentStatus.classList.remove("valid");
            currentStatus.querySelector(
              ".sync-confirm-checksum-icon"
            ).textContent = "✗";
            currentStatus.querySelector(
              ".sync-confirm-checksum-text"
            ).textContent = "代碼無效或格式錯誤";
          }
        } catch (error) {
          Logger.error("驗證分享代碼時發生錯誤:", error);
          const currentStatus = confirmDialog.querySelector(
            ".sync-confirm-checksum-status"
          );
          if (currentStatus) {
            currentStatus.classList.add("invalid");
            currentStatus.classList.remove("valid");
            currentStatus.querySelector(
              ".sync-confirm-checksum-icon"
            ).textContent = "!";
            currentStatus.querySelector(
              ".sync-confirm-checksum-text"
            ).textContent = "驗證錯誤";
          }
        }
      }, 300); // 300ms延遲，使用者停止輸入時觸發
    });

    // 還原按鈕
    resetBtn.addEventListener("click", () => {
      editedCode = originalCode;
      codeInput.value = originalCode;
      codeInput.focus();
    });

    // 模式切換事件
    modeButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        selectedRole = e.target.dataset.role;
        modeButtons.forEach((b) =>
          b.classList.remove("sync-confirm-mode-active")
        );
        e.target.classList.add("sync-confirm-mode-active");
      });
    });

    const closeDialog = () => {
      confirmDialog.remove();
      if (onCancel) onCancel();
    };

    const confirmAction = async () => {
      // 驗證分享代碼檢查碼
      try {
        // 顯示驗證中的狀態
        const confirmBtn = confirmDialog.querySelector(
          ".sync-confirm-btn-confirm"
        );
        const originalText = confirmBtn.textContent;
        confirmBtn.disabled = true;
        confirmBtn.textContent = "驗證中...";

        // 使用 SyncClient 驗證分享代碼
        const syncClient = window.syncManager?.core?.syncClient;
        if (!syncClient) {
          alert("同步服務未初始化");
          confirmBtn.disabled = false;
          confirmBtn.textContent = originalText;
          return;
        }

        const result = await syncClient.getShareCodeInfo(editedCode);

        // 還原按鈕狀態
        confirmBtn.disabled = false;
        confirmBtn.textContent = originalText;

        // 檢查代碼是否有效（未過期且未使用）
        if (!result || result.expired || result.used) {
          let reason = "代碼無效";
          if (result?.expired) reason = "代碼已過期";
          if (result?.used) reason = "代碼已被使用";
          alert(`分享代碼無效\n${reason}\n請檢查代碼是否正確`);
          Logger.error("分享代碼驗證失敗:", result);
          return;
        }

        // 驗證通過，關閉對話框並執行Callback
        Logger.debug(
          `分享代碼驗證通過，準備執行加入Callback - 代碼: ${editedCode}, 角色: ${selectedRole}`
        );
        confirmDialog.remove();
        if (onConfirm) onConfirm(editedCode, selectedRole);
      } catch (error) {
        Logger.error("驗證分享代碼時發生錯誤:", error);
        alert("驗證分享代碼時發生錯誤，請重試");
      }
    };

    btnConfirm.addEventListener("click", confirmAction);
    btnCancel.addEventListener("click", closeDialog);
    btnClose.addEventListener("click", closeDialog);
    overlay.addEventListener("click", closeDialog);

    // ESC 鍵支援
    const handleKeyPress = (e) => {
      if (e.key === "Escape") {
        document.removeEventListener("keydown", handleKeyPress);
        closeDialog();
      }
    };
    document.addEventListener("keydown", handleKeyPress);

    Logger.debug("所有事件綁定完成，對話框初始化完成");

    // 如果有初始分享代碼，手動觸發驗證
    if (code && code.trim()) {
      Logger.debug("檢測到初始分享代碼，開始驗證:", code);
      // 模擬input事件來觸發驗證
      const inputEvent = new Event("input", { bubbles: true });
      codeInput.dispatchEvent(inputEvent);
    }
  }
}

// 全域暴露供其他模組使用
window.SyncConfirmDialogManager = SyncConfirmDialogManager;





