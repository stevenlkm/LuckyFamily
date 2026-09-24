const { execFile } = require("child_process");
const recordSkill = require("./record");
const logger = require("../utils/logger");

let lastSpokenText = null;

/**
 * 核心廣播功能 (與錄音獨立解耦，播報成功即時完成，隨後非同步連動錄音)
 */
function broadcastText(bot, msg, textToSay) {
  const chatId = msg.chat.id;
  const hasChinese = /[\u4e00-\u9fff]/.test(textToSay);
  const voice = hasChinese ? "Sin-Ji" : "Samantha";

  lastSpokenText = textToSay;
  logger.task(chatId, "tts", `開始執行 say 語音廣播: "${textToSay}"`);

  execFile("say", ["-v", voice, textToSay], async (error) => {
    if (error) {
      logger.warn(
        "TtsSkill",
        `指定語音 ${voice} 廣播失敗，降級為預設語音: ${error.message}`,
      );
      return execFile("say", [textToSay], async (fallbackErr) => {
        if (fallbackErr) {
          logger.error("TtsSkill", "say 指令徹底廣播失敗", fallbackErr);
          return bot.safeSendMessage(
            chatId,
            `❌ 廣播失敗: ${fallbackErr.message}`,
          );
        }

        // 1. 獨立完成 /say 成功通知
        logger.info("TtsSkill", `廣播 (預設語音) 成功完成: "${textToSay}"`);
        await bot.safeSendMessage(
          chatId,
          `🔊 已廣播 (預設語音): "${textToSay}"`,
        );

        // 2. 非同步獨立連動現場錄音 (不干擾 /say 成功狀態)
        recordSkill.startRecordTask(bot, msg, 60, textToSay).catch((err) => {
          logger.error("TtsSkill", "廣播後連動錄音發生非同步異常", err);
        });
      });
    }

    const langName = hasChinese ? "廣東話" : "英文";
    logger.info("TtsSkill", `廣播 (${langName}) 成功完成: "${textToSay}"`);

    // 1. 獨立完成 /say 成功通知
    await bot.safeSendMessage(
      chatId,
      `🔊 已在 Mac Studio 廣播 (${langName}): "${textToSay}"`,
    );

    // 2. 非同步獨立連動現場錄音
    recordSkill.startRecordTask(bot, msg, 60, textToSay).catch((err) => {
      logger.error("TtsSkill", "廣播後連動錄音發生非同步異常", err);
    });
  });
}

module.exports = {
  name: "TTS Broadcast",
  description: "Mac 本地語音廣播",
  broadcastText,
  commands: [
    {
      cmd: "say",
      desc: "廣播語音並自動啟動現場錄音 (支援單行 `/say 內容` 或 分步輸入)",
      regex: /^\/(say|broadcast)(?:\s+(.+))?$/,
      handler: (bot, msg, match) => {
        const chatId = msg.chat.id;
        const textToSay = match[2] ? match[2].trim() : null;

        if (textToSay) {
          broadcastText(bot, msg, textToSay);
        } else {
          bot
            .safeSendMessage(chatId, "🗣️ 請輸入你想廣播嘅字句：", {
              reply_markup: {
                force_reply: true,
                selective: true,
              },
            })
            .then((sentMsg) => {
              const taskId = `reply_${sentMsg.message_id}`;

              const replyListener = (replyMsg) => {
                if (replyMsg.from.id !== msg.from.id) return;

                if (replyMsg.text) {
                  const trimmed = replyMsg.text.trim();

                  if (trimmed.startsWith("/")) {
                    bot.unregisterActiveTask(chatId, taskId);
                    return;
                  }

                  bot.unregisterActiveTask(chatId, taskId);
                  broadcastText(bot, replyMsg, trimmed);
                }
              };

              bot.onReplyToMessage(chatId, sentMsg.message_id, replyListener);

              bot.registerActiveTask(chatId, taskId, () => {
                bot.removeListener("message", replyListener);
                bot.safeSendMessage(chatId, "🛑 語音廣播對話已取消。");
              });
            });
        }
      },
    },
    {
      cmd: "repeat",
      desc: "重複廣播上一次嘅語句並啟動現場錄音 (別名: /rep)",
      regex: /^\/(repeat|rep)$/,
      handler: (bot, msg) => {
        const chatId = msg.chat.id;

        if (!lastSpokenText) {
          return bot.safeSendMessage(
            chatId,
            "⚠️ 目前沒有可重複嘅上一次廣播紀錄。",
          );
        }

        bot.safeSendMessage(
          chatId,
          `🔄 正在重複廣播上一次語句：\n"${lastSpokenText}"`,
        );
        broadcastText(bot, msg, lastSpokenText);
      },
    },
  ],
};
