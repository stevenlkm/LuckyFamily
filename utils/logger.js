const fs = require("fs");
const path = require("path");

// 確保 logs 目錄存在
const logsDir = path.join(__dirname, "../logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const appLogPath = path.join(logsDir, "app.log");
const errorLogPath = path.join(logsDir, "error.log");

/**
 * 取得香港標準時間戳
 */
function getTimestamp() {
  return new Date().toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" });
}

/**
 * 寫入 Log 至實體檔案
 */
function appendToFile(filePath, content) {
  try {
    fs.appendFileSync(filePath, content + "\n", "utf8");
  } catch (err) {
    console.error("❌ 寫入 Log 檔案失敗:", err.message);
  }
}

const logger = {
  info: (tag, message) => {
    const line = `[${getTimestamp()}] [INFO] [${tag}] ${message}`;
    console.log(`ℹ️ ${line}`);
    appendToFile(appLogPath, line);
  },

  warn: (tag, message) => {
    const line = `[${getTimestamp()}] [WARN] [${tag}] ${message}`;
    console.warn(`⚠️ ${line}`);
    appendToFile(appLogPath, line);
  },

  error: (tag, message, err = null) => {
    const errStack = err ? err.stack || err.message || String(err) : "";
    const line = `[${getTimestamp()}] [ERROR] [${tag}] ${message}${errStack ? " | " + errStack : ""}`;
    console.error(`❌ ${line}`);
    appendToFile(appLogPath, line);
    appendToFile(errorLogPath, line);
  },

  task: (chatId, taskId, action) => {
    const line = `[${getTimestamp()}] [TASK] [Chat:${chatId}] [${taskId}] ${action}`;
    console.log(`📌 ${line}`);
    appendToFile(appLogPath, line);
  },
};

module.exports = logger;
