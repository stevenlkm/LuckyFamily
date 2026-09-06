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

// 全局活躍任務註冊表 (Key: chatId, Value: Map of tasks)
bot.activeTasksMap = new Map();

/**
 * 註冊活躍任務 (供 /stop 或 /cancel 中斷)
 */
bot.registerActiveTask = function (chatId, taskId, cancelHandler) {
  if (!bot.activeTasksMap.has(chatId)) {
    bot.activeTasksMap.set(chatId, new Map());
  }
  bot.activeTasksMap.get(chatId).set(taskId, cancelHandler);
};

/**
 * 取消註冊任務
 */
bot.unregisterActiveTask = function (chatId, taskId) {
  if (bot.activeTasksMap.has(chatId)) {
    bot.activeTasksMap.get(chatId).delete(taskId);
  }
};

/**
 * 中斷指定 Chat 的所有進行中任務
 */
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

/**
 * 檢查發送者白名單權限
 */
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

/**
 * 動態載入 skills/ 目錄下的所有技能檔並同步至 Telegram Bot 指令選單
 */
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

  // 指令選單去重
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

// 在 loadSkills(); 執行後加入 callback_query 處理：
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  // 處理 CCTV 選單按鈕點擊 (cctv_living_room)
  if (data.startsWith('cctv_')) {
    const camKey = data.replace('cctv_', '');
    const cctvSkill = loadedSkills.find(s => s.name === 'CCTV Camera');
    
    bot.answerCallbackQuery(query.id, { text: '正在擷取畫面...' });
    
    // 執行截圖
    if (cctvSkill) {
      const cctvModule = require('./skills/cctv');
      // 調用抓圖
      const CAMERAS = {
        'living_room': { name: '客廳 (Tapo)', rtspUrl: 'rtsp://admin:your_password@192.168.1.100:554/stream1' },
        'front_door': { name: '門口 (Tapo)', rtspUrl: 'rtsp://admin:your_password@192.168.1.101:554/stream1' }
      };
      if (CAMERAS[camKey]) {
        // 直接觸發抓圖
        bot.emit('text_cmd', chatId, camKey);
      }
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