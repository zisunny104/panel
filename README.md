# 機台 MR 教學系統 - Panel

多裝置同步的 MR（混合實境）機台教學互動系統。

## 功能特色

- **多裝置同步**：支援多個客戶端即時同步實驗狀態
- **本機/同步模式**：自動判斷是否啟用同步功能
- **即時通訊**：基於 Server-Sent Events (SSE) 的雙向通訊
- **QR code 共享**：快速分享工作階段
- **實驗日誌**：完整的實驗資訊記錄和管理

## 技術堆疊

- **前端**：Vanilla JavaScript (ES6+)
- **即時通訊**：Server-Sent Events (SSE)
- **資訊持久化**：localStorage + Server-side session
- **樣式**：CSS3 + 響應式設計
- **後端**：PHP

## 專案結構

```
panel/
├── index.html              # 主頁面(機台面板)
├── experiment.html         # 實驗頁面(實驗管理)
├── js/                     # JavaScript 模組
│   ├── core/              # 核心功能
│   ├── experiment/        # 實驗相關
│   ├── panel/             # 面板控制
│   ├── power/             # 電源控制
│   ├── sync/              # 同步系統
│   └── ui/                # UI 組件
├── css/                   # 樣式表
├── data/                  # 設定資訊
├── assets/                # 資源檔案
└── php/                   # 後端服務
```

## 開發者

謝祥紫 Xiang-zi Xie(@zisunny104)、Github Copilot

## 版本

**1.5.gv0tm** (2026-01-08)

### 更新日誌

#### v1.5.gv0tm - 階段性成果上傳

- 多裝置同步系統基礎實現
- 實驗日誌記錄和管理
- SSE 即時通訊機制
- QR Code 工作階段分享
- 版本管理系統
