const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const adminIds = (process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map((id) => Number(id.trim()))
  .filter((id) => !isNaN(id) && id > 0);

module.exports = {
  name: "System Logs",
  description: "系統日誌即時 Trace 與 Debug",
  commands: [
    {
      cmd: "logs",
      desc: "檢視最新系統日誌 (用法: `/logs`, `/logs error`, `/logs 30`)",
      regex: /^\/logs(?:\s+(.+))?$/,
      handler: (bot, msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from ? msg.from.id : null;

        if (adminIds.length > 0 && !adminIds.includes(userId)) {
          logger.warn("LogsSkill", `未授權用戶 ${userId} 嘗試存取 /logs`);
          return bot.sendMessage(
            chatId,
            "⛔ 權限不足：`/logs` 指令僅限管理員使用。",
            { parse_mode: "Markdown" },
          );
        }

        const arg = match[1] ? match[1].trim().toLowerCase() : "";
        let targetFile = path.join(__dirname, "../logs/app.log");
        let lines = 25;

        if (arg === "error") {
          targetFile = path.join(__dirname, "../logs/error.log");
        } else if (!isNaN(Number(arg)) && Number(arg) > 0) {
          lines = Math.min(Number(arg), 100);
        }

        if (!fs.existsSync(targetFile)) {
          return bot.sendMessage(chatId, "ℹ️ 暫時沒有相關的 Log 紀錄檔案。");
        }

        // 使用 tail 指令快速讀取最後 N 行 Log
        execFile("tail", ["-n", String(lines), targetFile], (error, stdout) => {
          if (error) {
            logger.error("LogsSkill", "讀取 Log 檔案失敗", error);
            return bot.sendMessage(
              chatId,
              `❌ 讀取 Log 失敗: ${error.message}`,
            );
          }

          const output = stdout.trim() || "Log 檔案目前為空。";
          bot.sendMessage(
            chatId,
            `📜 *最新 ${lines} 行 Log 紀錄:*\n\`\`\`\n${output}\n\`\`\``,
            { parse_mode: "Markdown" },
          );
        });
      },
    },
  ],
};
