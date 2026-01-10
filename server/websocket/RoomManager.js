/**
 * 房間管理器
 *
 * 功能:
 * - 管理工作階段房間（Session → Clients 映射）
 * - 客戶端加入/離開房間
 * - 查詢房間成員
 * - 廣播房間狀態變更
 */

export class RoomManager {
  constructor(connectionManager) {
    this.connectionManager = connectionManager;

    // 房間資料: sessionId -> { clients: Set<clientId>, metadata: {...} }
    this.rooms = new Map();
  }

  /**
   * 客戶端加入房間
   * @param {string} sessionId - 工作階段 ID
   * @param {string} clientId - 客戶端 ID
   * @param {Object} metadata - 客戶端元資料 { role, ... }
   */
  join(sessionId, clientId, metadata = {}) {
    // 確保房間存在
    if (!this.rooms.has(sessionId)) {
      this.rooms.set(sessionId, {
        clients: new Map(), // clientId -> metadata
        createdAt: Date.now(),
      });
      console.log(`建立房間: ${sessionId}`);
    }

    const room = this.rooms.get(sessionId);

    // 新增客戶端到房間
    room.clients.set(clientId, {
      ...metadata,
      joinedAt: Date.now(),
    });

    console.log(`客戶端加入房間: ${clientId} -> ${sessionId}`);

    return {
      sessionId,
      clientId,
      clientCount: room.clients.size,
    };
  }

  /**
   * 客戶端離開房間
   * @param {string} sessionId - 工作階段 ID
   * @param {string} clientId - 客戶端 ID
   */
  leave(sessionId, clientId) {
    const room = this.rooms.get(sessionId);

    if (!room) {
      return false;
    }

    // 移除客戶端
    const removed = room.clients.delete(clientId);

    if (removed) {
      console.log(`客戶端離開房間: ${clientId} <- ${sessionId}`);

      // 如果房間空了，移除房間
      if (room.clients.size === 0) {
        this.rooms.delete(sessionId);
        console.log(`房間已清空: ${sessionId}`);
      }
    }

    return removed;
  }

  /**
   * 根據 clientId 查找並離開房間
   * @param {string} clientId - 客戶端 ID
   * @returns {string|null} sessionId - 離開的工作階段 ID
   */
  leaveByClientId(clientId) {
    for (const [sessionId, room] of this.rooms.entries()) {
      if (room.clients.has(clientId)) {
        this.leave(sessionId, clientId);
        return sessionId;
      }
    }
    return null;
  }

  /**
   * 獲取房間成員列表
   * @param {string} sessionId - 工作階段 ID
   * @returns {Array} 客戶端列表 [{ clientId, metadata }, ...]
   */
  getMembers(sessionId) {
    const room = this.rooms.get(sessionId);

    if (!room) {
      return [];
    }

    return Array.from(room.clients.entries()).map(([clientId, metadata]) => ({
      clientId,
      ...metadata,
    }));
  }

  /**
   * 獲取房間統計資訊
   * @param {string} sessionId - 工作階段 ID
   * @returns {Object|null} 統計資訊
   */
  getRoomInfo(sessionId) {
    const room = this.rooms.get(sessionId);

    if (!room) {
      return null;
    }

    return {
      sessionId,
      clientCount: room.clients.size,
      createdAt: room.createdAt,
      members: this.getMembers(sessionId),
    };
  }

  /**
   * 檢查客戶端是否在房間中
   * @param {string} sessionId - 工作階段 ID
   * @param {string} clientId - 客戶端 ID
   * @returns {boolean}
   */
  isMember(sessionId, clientId) {
    const room = this.rooms.get(sessionId);
    return room ? room.clients.has(clientId) : false;
  }

  /**
   * 獲取客戶端所在的房間
   * @param {string} clientId - 客戶端 ID
   * @returns {string|null} sessionId
   */
  getSessionByClientId(clientId) {
    for (const [sessionId, room] of this.rooms.entries()) {
      if (room.clients.has(clientId)) {
        return sessionId;
      }
    }
    return null;
  }

  /**
   * 獲取所有活躍房間
   * @returns {Array} 房間列表 [{ sessionId, clientCount, ... }, ...]
   */
  getAllRooms() {
    return Array.from(this.rooms.entries()).map(([sessionId, room]) => ({
      sessionId,
      clientCount: room.clients.size,
      createdAt: room.createdAt,
    }));
  }

  /**
   * 清空房間
   * @param {string} sessionId - 工作階段 ID
   */
  clearRoom(sessionId) {
    const removed = this.rooms.delete(sessionId);
    if (removed) {
      console.log(`房間已清空: ${sessionId}`);
    }
    return removed;
  }

  /**
   * 獲取統計資訊
   * @returns {Object}
   */
  getStats() {
    let totalClients = 0;
    for (const room of this.rooms.values()) {
      totalClients += room.clients.size;
    }

    return {
      totalRooms: this.rooms.size,
      totalClients,
    };
  }

  /**
   * 清空所有房間
   */
  clearAll() {
    console.log("正在清空所有房間...");
    this.rooms.clear();
    console.log("所有房間已清空");
  }
}
