import { experimentLogUI as legacyExperimentLogUI } from "./legacy/board-log-ui.js";

// 新命名入口：目前沿用 legacy UI，後續逐功能替換。
const recordPanel = legacyExperimentLogUI;

export { recordPanel, legacyExperimentLogUI };
