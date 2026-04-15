import LegacyExperimentLogManager, {
  ExperimentLogManager as LegacyExperimentLogManagerClass,
} from "./legacy/board-log-manager.js";

// 新命名入口：後續逐步將 legacy 實作切成功能模組。
const RecordService = LegacyExperimentLogManagerClass;

export default RecordService;
export { RecordService, LegacyExperimentLogManager, LegacyExperimentLogManagerClass };
