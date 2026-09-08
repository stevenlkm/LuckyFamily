const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const soundsDir = path.join(__dirname, "../assets/sounds");

/**
 * 動態尋找可用的音效檔案 (優先級: chime.mp3 -> chime.wav -> ding-3.wav -> 目錄內第一個音效檔)
 */
function getSoundFilePath() {
  const priorityFiles = [
    "chime.mp3",
    "chime.wav",
    "ding-3.wav",
    "ding.mp3",
    "bell.mp3",
  ];

  for (const fileName of priorityFiles) {
    const fullPath = path.join(soundsDir, fileName);
    if (fs.existsSync(fullPath)) return fullPath;
  }

  if (fs.existsSync(soundsDir)) {
    const files = fs
      .readdirSync(soundsDir)
      .filter((f) => /\.(mp3|wav|m4a|aiff)$/i.test(f));
    if (files.length > 0) {
      return path.join(soundsDir, files[0]);
    }
  }

  return null;
}

/**
 * 使用 macOS 原生 afplay 工具播放音效
 */
function playSound(bot, chatId) {
  const soundFilePath = getSoundFilePath();

  if (!soundFilePath) {
    logger.error("SoundSkill", `找不到任何音效檔案在目錄: ${soundsDir}`);
    return bot.sendMessage(
      chatId,
      `❌ 播放失敗：找不到音效檔案。\n💡 請確認已將 MP3/WAV 音效檔放喺 \`assets/sounds/chime.mp3\`。`,
      { parse_mode: "Markdown" },
    );
  }

  const fileName = path.basename(soundFilePath);
  logger.task(chatId, "sound", `開始於 Mac Studio 播放音效: ${fileName}`);
  bot.sendMessage(
    chatId,
    `🔔 正在 Mac Studio 播放提示音效 (\`${fileName}\`)...`,
    { parse_mode: "Markdown" },
  );

  // 呼叫 macOS 原生 afplay 指令
  const childProc = execFile(
    "afplay",
    [soundFilePath],
    (error, stdout, stderr) => {
      bot.unregisterActiveTask(chatId, "sound");

      if (error) {
        const errMsg = (stderr || error.message).trim();
        logger.error("SoundSkill", `afplay 播放失敗 [${fileName}]`, errMsg);

        let hint = "";
        if (errMsg.includes("AudioFileOpen failed")) {
          hint =
            "\n\n💡 *提示*：此 WAV 檔案 Header 結構不受 macOS CoreAudio 支援，請將檔案轉碼為標準 **MP3** 格式 (`chime.mp3`)。";
        }

        return bot.sendMessage(
          chatId,
          `❌ 音效播放失敗: \`${errMsg}\`${hint}`,
          { parse_mode: "Markdown" },
        );
      }

      logger.info("SoundSkill", `音效 [${fileName}] 播放成功完成`);
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
