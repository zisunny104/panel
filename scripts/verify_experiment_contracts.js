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

function assertIncludes(filePath, snippet, message) {
  const content = read(filePath);
  if (!content.includes(snippet)) {
    throw new Error(`${message} | missing snippet in ${filePath}: ${snippet}`);
  }
}

function run() {
  const checks = [
    () =>
      assertIncludes(
        "js/panel/panel-sync-manager.js",
        "role: this._getSyncRole()",
        "panel lifecycle payload must include role",
      ),
    () =>
      assertIncludes(
        "js/panel/panel-sync-manager.js",
        "source: startData.source || \"flow_local\"",
        "panel started payload must include source",
      ),
    () =>
      assertIncludes(
        "js/panel/panel-sync-manager.js",
        "source: pauseData.source || \"flow_local\"",
        "panel paused payload must include source",
      ),
    () =>
      assertIncludes(
        "js/panel/panel-sync-manager.js",
        "source: resumeData.source || \"flow_local\"",
        "panel resumed payload must include source",
      ),
    () =>
      assertIncludes(
        "js/panel/panel-sync-manager.js",
        "source: stopData.source || \"flow_local\"",
        "panel stopped payload must include source",
      ),
    () =>
      assertIncludes(
        "js/panel/panel-sync-manager.js",
        "if (startData.broadcast === false) return;",
        "no-echo contract for started event",
      ),
    () =>
      assertIncludes(
        "js/panel/panel-sync-manager.js",
        "if (pauseData.broadcast === false) return;",
        "no-echo contract for paused event",
      ),
    () =>
      assertIncludes(
        "js/panel/panel-sync-manager.js",
        "if (resumeData.broadcast === false) return;",
        "no-echo contract for resumed event",
      ),
    () =>
      assertIncludes(
        "js/experiment/experiment-system-manager.js",
        "broadcast: false, source: \"sync\"",
        "system manager must apply remote lifecycle with broadcast disabled",
      ),
    () =>
      assertIncludes(
        "js/experiment/experiment-flow-manager.js",
        "const broadcast = options.broadcast !== false;",
        "flow manager lifecycle must support broadcast option",
      ),
    () =>
      assertIncludes(
        "js/board/board-page-manager.js",
        "if (data?.broadcast === false)",
        "board completed path must support no-echo gating",
      ),
    () =>
      assertIncludes(
        "js/panel/panel-button-manager.js",
        "const jumpResult = this._jumpToActionById(nextActionId)",
        "panel action jump should use centralized wrapper",
      ),
    () =>
      assertIncludes(
        "js/panel/panel-page-manager.js",
        "this.experimentFlowManager.injectDependencies({",
        "panel flow manager should use injectDependencies",
      ),
    () =>
      assertIncludes(
        "js/board/board-page-manager.js",
        "this.experimentFlowManager?.injectDependencies?.({",
        "board flow manager should use injectDependencies",
      ),
    () =>
      assertIncludes(
        "js/board/board-init.js",
        "page.experimentFlowManager.injectDependencies({",
        "board initialization should inject flow manager dependencies via injectDependencies",
      ),
    () =>
      assertIncludes(
        "js/experiment/experiment-system-manager.js",
        "this.flowManager.injectDependencies({ actionHandler });",
        "system manager should inject action handler through injectDependencies",
      ),
    () =>
      assertIncludes(
        "js/experiment/experiment-flow-manager.js",
        "injectDependencies({",
        "flow manager should expose injectDependencies as dependency injection entry",
      ),
    () =>
      assertIncludes(
        "js/panel/panel-page-manager.js",
        "await this._initializeExperimentUIAndData();",
        "panel initialization should load experiment UI and data before runtime binding",
      ),
  ];

  checks.forEach((check) => check());
  console.log("[verify_experiment_contracts] PASS");
}

try {
  run();
} catch (error) {
  console.error("[verify_experiment_contracts] FAIL");
  console.error(error.message || error);
  process.exitCode = 1;
}
