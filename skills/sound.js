const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

// 預設音效檔案儲存路徑
const soundFilePath = path.join(__dirname, "../assets/sounds/chime.mp3");

/**
 * 使用 macOS 原生 afplay 工具播放音效
 */
function playSound(bot, chatId) {
  if (!fs.existsSync(soundFilePath)) {
    logger.error("SoundSkill", `找不到音效檔案: ${soundFilePath}`);
    return bot.sendMessage(
      chatId,
      `❌ 播放失敗：找不到音效檔案。\n💡 請確認已將 MP3 檔案儲存至 \`assets/sounds/chime.mp3\`。`,
      { parse_mode: "Markdown" },
    );
  }

  logger.task(chatId, "sound", "開始於 Mac Studio 播放提示音效");
  bot.sendMessage(chatId, "🔔 正在 Mac Studio 播放提示音效...");

  // 呼叫 macOS 原生 afplay 指令
  const childProc = execFile(
    "afplay",
    [soundFilePath],
    (error, stdout, stderr) => {
      bot.unregisterActiveTask(chatId, "sound");

      if (error) {
        logger.error("SoundSkill", "afplay 播放失敗", stderr || error);
        return bot.sendMessage(
          chatId,
          `❌ 音效播放失敗: ${stderr || error.message}`,
        );
      }

      logger.info("SoundSkill", "音效播放成功完成");
      bot.sendMessage(chatId, "✅ 提示音效播放完畢。");
    },
  );

  // 註冊至 Task Manager，支援 /stop 中斷
  bot.registerActiveTask(chatId, "sound", () => {
    try {
      childProc.kill("SIGKILL");
    } catch (e) {}
    logger.warn("SoundSkill", `用戶 [Chat:${chatId}] 中斷了音效播放`);
    bot.sendMessage(chatId, "🛑 音效播放已被用戶取消。");
  });
}

module.exports = {
  name: "Sound Effect",
  description: "Mac 本地門鈴/提示音效播放",
  playSound,
  commands: [
    {
      cmd: "chime",
      desc: "喺 Mac Studio 播放門鈴/提示音效 (別名: /bell, /sound)",
      regex: /^\/(chime|bell|sound)$/,
      handler: (bot, msg) => {
        playSound(bot, msg.chat.id);
      },
    },
  ],
};
