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

          // 提取主指令名稱（符合 Telegram ^[a-z0-9_]+$ 規範）
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

  // 向 Telegram 伺服器註冊彈出式 Command 選單
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

// 執行技能動態載入
loadSkills();

// 動態彙整所有 Skill 的說明選單
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
