import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

function read(relPath) {
  const abs = path.join(root, relPath);
  return fs.readFileSync(abs, "utf8");
}

function mustContain(filePath, snippet, requirement) {
  const content = read(filePath);
  if (!content.includes(snippet)) {
    throw new Error(`${requirement} | missing snippet in ${filePath}: ${snippet}`);
  }
}

function run() {
  const checks = [
    () =>
      mustContain(
        "js/panel/panel-sync-manager.js",
        "dispatchSessionRestoreEvents(event.detail, { includePowerState: false });",
        "panel restore path should not restore power state",
      ),
    () =>
      mustContain(
        "js/board/board-sync-io.js",
        "dispatchSessionRestoreEvents(event.detail, { includePowerState: false });",
        "board restore path should not restore power state",
      ),
    () =>
      mustContain(
        "js/board/board-page-manager.js",
        "if (this.experimentFlowManager?.isRunning)",
        "board must have running-state guard logic",
      ),
    () =>
      mustContain(
        "js/board/board-page-manager.js",
        "RecordView 刷新略過重置：實驗仍在進行中",
        "board should skip gesture reset during running experiment",
      ),
    () =>
      mustContain(
        "js/record/record-manager.js",
        "if (this.stateManager?.isExperimentRunning)",
        "record manager must guard non-running fallback behavior",
      ),
    () =>
      mustContain(
        "js/sync/sync-manager-core.js",
        "_normalizeStatePayload(state)",
        "sync manager core must normalize outbound payload",
      ),
    () =>
      mustContain(
        "js/sync/sync-manager-core.js",
        "const normalizedState = this._normalizeStatePayload(state);",
        "sync manager core must use normalized payload before send",
      ),
  ];

  checks.forEach((check) => check());
  console.log("[verify_experiment_resilience] PASS");
}

try {
  run();
} catch (error) {
  console.error("[verify_experiment_resilience] FAIL");
  console.error(error.message || error);
  process.exitCode = 1;
}
