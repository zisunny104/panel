#!/usr/bin/env node

/**
 * 版本更新自動化腳本
 * 用於自動更新 config.json 中的 git commit hash 和版本號
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CONFIG_PATH = path.join(__dirname, "..", "data", "config.json");

/**
 * 取得 git commit hash
 */
function getGitCommitHash(length = 7) {
  try {
    return execSync(`git rev-parse --short=${length} HEAD`, {
      encoding: "utf8"
    }).trim();
  } catch (error) {
    console.error("無法取得 git commit hash:", error.message);
    return null;
  }
}

/**
 * 讀取 config.json
 */
function readConfig() {
  try {
    const configData = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(configData);
  } catch (error) {
    console.error("讀取 config.json 失敗:", error.message);
    process.exit(1);
  }
}

/**
 * 寫入 config.json
 */
function writeConfig(config) {
  try {
    // 格式化 JSON（縮排 4 個空格）
    const formattedConfig = JSON.stringify(config, null, 4);
    fs.writeFileSync(CONFIG_PATH, formattedConfig + "\n", "utf8");
    console.log("config.json 已更新");
  } catch (error) {
    console.error("寫入 config.json 失敗:", error.message);
    process.exit(1);
  }
}

/**
 * 更新 git commit hash
 */
function updateGitCommitHash() {
  const config = readConfig();
  const currentHash = config.git_commit_hash;
  const newHash = getGitCommitHash();

  if (!newHash) {
    console.error("無法取得 git commit hash");
    process.exit(1);
  }

  if (currentHash === newHash) {
    console.log(`git commit hash 無變化: ${currentHash}`);
    return false;
  }

  console.log(`更新 git commit hash: ${currentHash} → ${newHash}`);
  config.git_commit_hash = newHash;
  // 使用設定檔中的時區設定
  const timezone = config.timezone || "Asia/Taipei";
  config.updated_at =
    new Date()
      .toLocaleString("zh-TW", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      })
      .replace(/\//g, "-") + ".000Z";

  writeConfig(config);
  return true;
}

/**
 * 更新版本號
 */
function updateVersion() {
  const config = readConfig();
  const currentVersion = config.version;

  // 簡單的版本號遞增邏輯（你可以修改這個邏輯）
  const versionParts = currentVersion.split(".");
  const major = parseInt(versionParts[0]) || 1;
  const minor = parseInt(versionParts[1]) || 1;

  // 使用 git commit hash 作為 patch 版本
  const gitHash = getGitCommitHash();
  const newVersion = `${major}.${minor}.${gitHash}`;

  if (currentVersion === newVersion) {
    console.log(`版本號無變化: ${currentVersion}`);
    return false;
  }

  console.log(`更新版本號: ${currentVersion} → ${newVersion}`);
  config.version = newVersion;
  // 使用設定檔中的時區設定
  const timezone = config.timezone || "Asia/Taipei";
  config.updated_at =
    new Date()
      .toLocaleString("zh-TW", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      })
      .replace(/\//g, "-") + ".000Z";

  writeConfig(config);
  return true;
}

/**
 * 顯示幫助資訊
 */
function showHelp() {
  console.log(`
版本更新自動化腳本

用法:
  node scripts/update-version.js [command]

命令:
  hash        更新 git commit hash
  version     更新版本號
  all         更新 hash 和版本號
  status      顯示目前狀態

範例:
  node scripts/update-version.js hash
  node scripts/update-version.js version
  node scripts/update-version.js all
  node scripts/update-version.js status
`);
}

/**
 * 顯示目前狀態
 */
function showStatus() {
  const config = readConfig();
  const currentGitHash = getGitCommitHash();

  console.log("目前狀態:");
  console.log(`   設定檔版本: ${config.version}`);
  console.log(`   設定檔 git hash: ${config.git_commit_hash || "未設定"}`);
  console.log(`   實際 git hash: ${currentGitHash || "無法取得"}`);
  console.log(`   最後更新: ${config.updated_at}`);
}

// 主程式
const command = process.argv[2];

switch (command) {
  case "hash":
    updateGitCommitHash();
    break;
  case "version":
    updateVersion();
    break;
  case "all":
    const hashUpdated = updateGitCommitHash();
    const versionUpdated = updateVersion();
    if (!hashUpdated && !versionUpdated) {
      console.log("所有項目都是最新的");
    }
    break;
  case "status":
    showStatus();
    break;
  default:
    showHelp();
    break;
}
