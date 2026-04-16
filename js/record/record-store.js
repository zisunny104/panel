/**
 * recordStore - IndexedDB 儲存層
 *
 * 集中處理 IndexedDB 初始化、讀寫與清除。
 * 作為 mixin 混入 RecordManager。
 */

export const recordStore = {
  /**
   * 取得所有日誌（記憶體 + IndexedDB）
   * @returns {Promise<Array>}
   */
  async getAllLogs() {
    try {
      if (!this.db) {
        Logger.warn("IndexedDB 尚未初始化，僅回傳記憶體中的日誌");
        return [...this.records, ...this.pendingRecords];
      }

      const transaction = this.db.transaction([this.pendingRecordsStore], "readonly");
      const store = transaction.objectStore(this.pendingRecordsStore);
      const request = store.getAll();

      return new Promise((resolve) => {
        request.onsuccess = (event) => {
          const storedLogs = event.target.result || [];
          const unpersistedLogs = [];
          const seenRecords = new Set();
          [...this.records, ...this.pendingRecords].forEach((record) => {
            if (!record || this._persistedRecordRefs?.has(record) || seenRecords.has(record)) return;
            seenRecords.add(record);
            unpersistedLogs.push(record);
          });
          const allLogs = [...storedLogs, ...unpersistedLogs];
          allLogs.sort((a, b) => a.ts - b.ts);
          resolve(allLogs);
        };
        request.onerror = () => resolve([...this.records, ...this.pendingRecords]);
      });
    } catch (error) {
      Logger.error("getAllLogs 發生錯誤:", error);
      return [...this.records, ...this.pendingRecords];
    }
  },

  /**
   * 根據實驗 ID 取得日誌
   * @param {string} experimentId
   * @returns {Promise<Array>}
   */
  async getLogsByExperimentId(experimentId) {
    const allLogs = await this.getAllLogs();
    return allLogs.filter(
      (log) => log.exp_id === experimentId || log.experimentId === experimentId,
    );
  },

  /**
   * 刪除指定實驗的所有日誌
   * @param {string} experimentId
   * @returns {Promise<boolean>}
   */
  async deleteExperiment(experimentId) {
    try {
      if (!this.db) return false;

      const transaction = this.db.transaction([this.pendingRecordsStore], "readwrite");
      const store = transaction.objectStore(this.pendingRecordsStore);
      const getAllRequest = store.getAll();

      return new Promise((resolve, reject) => {
        getAllRequest.onsuccess = (event) => {
          const logsToDelete = (event.target.result || []).filter(
            (log) => log.exp_id === experimentId || log.experimentId === experimentId,
          );

          if (logsToDelete.length === 0) {
            resolve(true);
            return;
          }

          let deletedCount = 0;
          logsToDelete.forEach((log, index) => {
            const deleteRequest = store.delete(log.id || index);
            deleteRequest.onsuccess = () => {
              if (++deletedCount === logsToDelete.length) {
                Logger.info(`已刪除實驗 ${experimentId} 的 ${deletedCount} 條日誌`);
                this._broadcastMessage("experimentDeleted", { experimentId });
                this.records = this.records.filter((record) => record.exp_id !== experimentId && record.experimentId !== experimentId);
                this.pendingRecords = this.pendingRecords.filter((record) => record.exp_id !== experimentId && record.experimentId !== experimentId);
                resolve(true);
              }
            };
            deleteRequest.onerror = (e) => reject(e.target.error);
          });
        };
        getAllRequest.onerror = (event) => reject(event.target.error);
      });
    } catch (error) {
      Logger.error(`刪除實驗 ${experimentId} 失敗:`, error);
      return false;
    }
  },

  // ─── IndexedDB 內部方法 ────────────────────────────────────────────────────

  _initIndexedDB() {
    if (!window.indexedDB) {
      Logger.warn("IndexedDB 不支援，日誌將只存在記憶體中");
      this.db = null;
      return;
    }

    const request = indexedDB.open(this.dbName, this.dbVersion);

    request.onerror = (event) => {
      Logger.error("IndexedDB 初始化失敗:", event.target.error);
      this.db = null;
    };

    request.onsuccess = (event) => {
      this.db = event.target.result;
      Logger.debug("IndexedDB 初始化成功");
      this._persistBufferedRecordsToIndexedDB();
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(this.pendingRecordsStore)) {
        const objectStore = db.createObjectStore(this.pendingRecordsStore, {
          keyPath: "id",
          autoIncrement: true,
        });
        objectStore.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
  },

  async _persistBufferedRecordsToIndexedDB() {
    if (!this.db) return;

    const transaction = this.db.transaction([this.pendingRecordsStore], "readwrite");
    const store = transaction.objectStore(this.pendingRecordsStore);

    const bufferedRecords = [];
    const seenRecords = new Set();
    [...this.records, ...this.pendingRecords].forEach((record) => {
      if (!record || this._persistedRecordRefs?.has(record) || seenRecords.has(record)) return;
      seenRecords.add(record);
      bufferedRecords.push(record);
    });

    if (bufferedRecords.length === 0) return;

    await Promise.all(
      bufferedRecords.map((record) => new Promise((resolve) => {
        const req = store.add({ ...record, savedAt: Date.now() });
        req.onsuccess = () => {
          this._persistedRecordRefs?.add(record);
          resolve();
        };
        req.onerror = () => resolve();
      })),
    );
  },

  _saveLogToIndexedDB(logEntry) {
    if (!this.db) return;
    const transaction = this.db.transaction([this.pendingRecordsStore], "readwrite");
    const store = transaction.objectStore(this.pendingRecordsStore);
    const request = store.add({ ...logEntry, savedAt: Date.now() });
    request.onsuccess = () => {
      this._persistedRecordRefs?.add(logEntry);
    };
    request.onerror = (event) => {
      Logger.error("儲存日誌到 IndexedDB 失敗:", event.target.error);
    };
  },

  /**
   * 從 IndexedDB 刪除已發送的日誌（根據 id 欄位逐一刪除）
   * @param {Array} sentLogs - 已完成發送的日誌物件陣列（需含 id 欄位）
   */
  _removeLogsFromIndexedDB(sentLogs) {
    if (!this.db || !sentLogs?.length) return;
    const transaction = this.db.transaction([this.pendingRecordsStore], "readwrite");
    const store = transaction.objectStore(this.pendingRecordsStore);
    sentLogs.forEach((log) => {
      if (log.id) store.delete(log.id);
    });
  },

  async _removeLogsByExperimentIdFromIndexedDB(experimentId) {
    if (!this.db || !experimentId) return;

    const transaction = this.db.transaction([this.pendingRecordsStore], "readwrite");
    const store = transaction.objectStore(this.pendingRecordsStore);
    const request = store.getAll();

    await new Promise((resolve, reject) => {
      request.onsuccess = (event) => {
        const logsToDelete = (event.target.result || []).filter(
          (log) => log.exp_id === experimentId,
        );
        if (logsToDelete.length === 0) { resolve(); return; }

        let deletedCount = 0;
        logsToDelete.forEach((log) => {
          const req = store.delete(log.id);
          req.onsuccess = () => {
            if (++deletedCount === logsToDelete.length) {
              Logger.debug(`已清除 IndexedDB 中實驗 ${experimentId} 的 ${deletedCount} 筆日誌`);
              this.records = this.records.filter((record) => record.exp_id !== experimentId);
              this.pendingRecords = this.pendingRecords.filter((record) => record.exp_id !== experimentId);
              resolve();
            }
          };
          req.onerror = (e) => reject(e.target.error);
        });
      };
      request.onerror = (event) => reject(event.target.error);
    }).catch((err) => Logger.error("清除 IndexedDB 日誌失敗:", err));
  },

  _clearIndexedDB() {
    if (!this.db) return;
    const transaction = this.db.transaction([this.pendingRecordsStore], "readwrite");
    const store = transaction.objectStore(this.pendingRecordsStore);
    store.clear().onsuccess = () => {
      Logger.debug("IndexedDB 已清空");
      this._broadcastMessage("recordsCleared", {});
    };
  },
};
