require("dotenv").config();
const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

const token = process.env.TELEGRAM_BOT_TOKEN;
const allowedIds = (process.env.ALLOWED_TELEGRAM_IDS || "")
  .split(",")
  .map((id) => Number(id.trim()))
  .filter((id) => !isNaN(id) && id > 0);

if (!token) {
  console.error("❌ 錯誤：未在 .env 設定 TELEGRAM_BOT_TOKEN！");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const loadedSkills = [];

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
      console.error("中斷任務時發生錯誤:", err);
    }
  });
  tasks.clear();
  return true;
};

console.log("🤖 Mac Studio 家居遙控 Bot 啟動中...");

function isAuthorized(msg) {
  const userId = msg.from ? msg.from.id : null;
  if (allowedIds.length > 0 && !allowedIds.includes(userId)) {
    console.warn(`⚠️ [拒絕存取] 未授權用戶 - ID: ${userId}`);
    bot.sendMessage(
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
      console.log(`✅ 已成功載入 Skill: [${skill.name}] (${file})`);
    } catch (err) {
      console.error(`❌ 載入 Skill 失敗 [${file}]:`, err.message);
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
        console.log(
          `🤖 Telegram Bot 原生指令選單 (${finalCommands.length} 個指令) 已成功同步！`,
        ),
      )
      .catch((err) =>
        console.error("❌ 設定 Telegram 選單指令失敗:", err.message),
      );
  }
}

loadSkills();

// 監聽 Inline Keyboard 按鈕點擊 (支援 CCTV 截圖與智能家居裝置控制)
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
      console.error("觸發 CCTV 截圖失敗:", err);
      bot.sendMessage(chatId, `❌ 執行截圖失敗: ${err.message}`);
    }
  } else if (data.startsWith("dev_")) {
    const actionKey = data.replace("dev_", "");
    try {
      const deviceModule = require("./skills/device");
      deviceModule.handleDeviceCallback(bot, query, actionKey);
    } catch (err) {
      console.error("觸發裝置控制失敗:", err);
      bot.sendMessage(chatId, `❌ 執行裝置控制失敗: ${err.message}`);
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

  bot.sendMessage(msg.chat.id, helpMsg.trim(), { parse_mode: "Markdown" });
});

bot.on("polling_error", (error) => {
  console.error("Telegram Polling 錯誤:", error.message);
});
