require("dotenv").config();
const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const logger = require("./utils/logger");

const token = process.env.TELEGRAM_BOT_TOKEN;
const allowedIds = (process.env.ALLOWED_TELEGRAM_IDS || "")
  .split(",")
  .map((id) => Number(id.trim()))
  .filter((id) => !isNaN(id) && id > 0);

if (!token) {
  logger.error("System", "未在 .env 設定 TELEGRAM_BOT_TOKEN！");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const loadedSkills = [];

// ⚠️ 全局防護：捕獲未處理例外與 Rejection，防止 PM2 進程崩潰
process.on("uncaughtException", (err) => {
  logger.error("System", "未捕獲的例外 (uncaughtException)", err);
});

process.on("unhandledRejection", (reason) => {
  logger.error("System", "未處理的 Rejection (unhandledRejection)", reason);
});

/**
 * 🛡️ 安全發送訊息方法 (若 Markdown 解析失敗，自動降級為純文字發送，防止 400 錯誤導致 PM2 崩潰)
 */
bot.safeSendMessage = async function (chatId, text, options = {}) {
  try {
    return await bot.sendMessage(chatId, text, options);
  } catch (err) {
    if (err.message && err.message.includes("can't parse entities")) {
      logger.warn(
        "TelegramBot",
        `Markdown 解析失敗，自動降級為純文字發送: ${err.message}`,
      );
      const plainOptions = { ...options };
      delete plainOptions.parse_mode;
      return await bot.sendMessage(chatId, text, plainOptions);
    }
    logger.error("TelegramBot", `發送訊息失敗 [Chat:${chatId}]`, err);
    throw err;
  }
};

// 全局活躍任務註冊表
bot.activeTasksMap = new Map();

bot.registerActiveTask = function (chatId, taskId, cancelHandler) {
  if (!bot.activeTasksMap.has(chatId)) {
    bot.activeTasksMap.set(chatId, new Map());
  }
  bot.activeTasksMap.get(chatId).set(taskId, cancelHandler);
};

bot.unregisterActiveTask = function (chatId, taskId) {
  if (bot.activeTasksMap.has(chatId)) {
    bot.activeTasksMap.get(chatId).delete(taskId);
  }
};

bot.cancelActiveTasks = function (chatId) {
  if (
    !bot.activeTasksMap.has(chatId) ||
    bot.activeTasksMap.get(chatId).size === 0
  ) {
    return false;
  }
  const tasks = bot.activeTasksMap.get(chatId);
  tasks.forEach((cancelHandler) => {
    try {
      if (typeof cancelHandler === "function") cancelHandler();
    } catch (err) {
      logger.error("System", "中斷任務時發生錯誤", err);
    }
  });
  tasks.clear();
  return true;
};

logger.info("System", "🤖 Mac Studio 家居遙控 Bot 啟動中...");

function isAuthorized(msg) {
  const userId = msg.from ? msg.from.id : null;
  if (allowedIds.length > 0 && !allowedIds.includes(userId)) {
    logger.warn("Auth", `拒絕存取未授權用戶 - ID: ${userId}`);
    bot.safeSendMessage(
      msg.chat.id,
      "⛔ 存取被拒絕：你的 Telegram ID 不在白名單內。",
    );
    return false;
  }
  return true;
}

function loadSkills() {
  const skillsDir = path.join(__dirname, "skills");
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir);
  }

  const files = fs.readdirSync(skillsDir).filter((f) => f.endsWith(".js"));
  const rawTelegramCommands = [];

  files.forEach((file) => {
    try {
      const skillPath = path.join(skillsDir, file);
      const skill = require(skillPath);
      loadedSkills.push(skill);

      if (Array.isArray(skill.commands)) {
        skill.commands.forEach((cmdObj) => {
          const pattern =
            cmdObj.regex || new RegExp(`^\\/${cmdObj.cmd}(?:\\s+.*)?$`);

          bot.onText(pattern, (msg, match) => {
            if (!isAuthorized(msg)) return;
            cmdObj.handler(bot, msg, match);
          });

          const cleanCmd = cmdObj.cmd
            .split(" ")[0]
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, "");
          if (cleanCmd) {
            rawTelegramCommands.push({
              command: cleanCmd,
              description: cmdObj.desc.substring(0, 256),
            });
          }
        });
      }
      logger.info("Skills", `已成功載入 Skill: [${skill.name}] (${file})`);
    } catch (err) {
      logger.error("Skills", `載入 Skill 失敗 [${file}]`, err);
    }
  });

  const uniqueCmds = new Map();
  rawTelegramCommands.forEach((c) => {
    if (!uniqueCmds.has(c.command)) {
      uniqueCmds.set(c.command, c);
    }
  });

  const finalCommands = Array.from(uniqueCmds.values());

  if (finalCommands.length > 0) {
    bot
      .setMyCommands(finalCommands)
      .then(() =>
        logger.info(
          "System",
          `Telegram Bot 原生指令選單 (${finalCommands.length} 個指令) 已成功同步！`,
        ),
      )
      .catch((err) =>
        logger.error("System", "設定 Telegram 選單指令失敗", err),
      );
  }
}

loadSkills();

// 監聽 Inline Keyboard 按鈕點擊
bot.on("callback_query", (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith("cctv_")) {
    const camKey = data.replace("cctv_", "");
    bot.answerCallbackQuery(query.id, { text: "正在擷取畫面..." });

    try {
      const cctvModule = require("./skills/cctv");
      cctvModule.captureRtspSnapshot(bot, chatId, camKey);
    } catch (err) {
      logger.error("CCTV", "觸發 CCTV 截圖失敗", err);
      bot.safeSendMessage(chatId, `❌ 執行截圖失敗: ${err.message}`);
    }
  } else if (data.startsWith("dev_")) {
    const actionKey = data.replace("dev_", "");
    try {
      const deviceModule = require("./skills/device");
      deviceModule.handleDeviceCallback(bot, query, actionKey);
    } catch (err) {
      logger.error("Device", "觸發裝置控制失敗", err);
      bot.safeSendMessage(chatId, `❌ 執行裝置控制失敗: ${err.message}`);
    }
  }
});

bot.onText(/\/start|\/help/, (msg) => {
  if (!isAuthorized(msg)) return;

  let helpMsg = `🏠 *Mac Studio 家居遙控系統*\n\n歡迎，${msg.from.first_name}！可用指令：\n\n`;

  loadedSkills.forEach((skill) => {
    helpMsg += `*【${skill.description || skill.name}】*\n`;
    skill.commands.forEach((c) => {
      helpMsg += `🔹 /${c.cmd} - ${c.desc}\n`;
    });
    helpMsg += `\n`;
  });

  bot.safeSendMessage(msg.chat.id, helpMsg.trim(), { parse_mode: "Markdown" });
});

bot.on("polling_error", (error) => {
  logger.error("TelegramBot", "Polling 錯誤", error);
});
