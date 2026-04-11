/**
 * CameraUtils - 相機工具類
 * 負責處理相機設備列舉、啟動、停止和重試邏輯
 */

class CameraUtils {
  constructor() {
    this.cameraLoading = false;
    this.availableVideoDevices = [];
    this.lastCameraAttempts = [];
    this.currentStream = null;
  }

  /**
   * 檢查設備標籤是否為虛擬設備
   */
  static isVirtualDeviceLabel(label) {
    if (!label) return false;
    const l = label.toLowerCase();
    const virtualKeywords = [
      "meta quest",
      "obs",
      "virtual",
      "nvidia",
      "oculus",
      "quest",
      "vr",
    ];
    return virtualKeywords.some((k) => l.includes(k));
  }

  /**
   * 排序視訊設備列表
   */
  static sortVideoDevices(videoDevices) {
    if (!Array.isArray(videoDevices)) return videoDevices;
    return videoDevices.slice().sort((a, b) => {
      const aIsVirtual = CameraUtils.isVirtualDeviceLabel(a.label || "");
      const bIsVirtual = CameraUtils.isVirtualDeviceLabel(b.label || "");
      if (aIsVirtual && !bIsVirtual) return 1;
      if (!aIsVirtual && bIsVirtual) return -1;
      return 0;
    });
  }

  /**
   * 重新整理設備列表
   */
  async refreshDeviceList() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === "videoinput");
      const sorted = CameraUtils.sortVideoDevices(videoDevices);
      const mapped = sorted.map((d) => ({
        ...d,
        clientId: d.clientId || d.deviceId || "",
      }));
      this.availableVideoDevices = mapped;
      return mapped;
    } catch (error) {
      Logger.warn("CameraUtils.refreshDeviceList failed:", error);
      throw error;
    }
  }

  /**
   * 停止目前串流
   */
  async stopCurrentStream() {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach((t) => t.stop());
      this.currentStream = null;
    }
  }

  /**
   * 啟動相機
   */
  async startCamera(clientId = "", options = {}) {
    // 停掉現有 stream
    await this.stopCurrentStream();

    const baseVideo = { width: { ideal: 640 }, height: { ideal: 480 } };

    let constraints = {
      video: clientId
        ? { ...baseVideo, clientId: { exact: clientId } }
        : { ...baseVideo },
      audio: false,
    };

    if (this.cameraLoading) {
      Logger.warn("CameraUtils: camera already loading");
      throw new Error("camera-loading");
    }

    this.cameraLoading = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.currentStream = stream;
      return stream;
    } catch (error) {
      Logger.error("CameraUtils.startCamera error:", error);
      throw error;
    } finally {
      this.cameraLoading = false;
    }
  }

  /**
   * 重試相機
   */
  async retryCamera(clientId = "") {
    await this.stopCurrentStream();
    return this.startCamera(clientId);
  }
}

export default CameraUtils;
