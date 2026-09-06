const { execFile } = require("child_process");
const recordSkill = require("./record");

let lastSpokenText = null;

/**
 * 核心廣播功能 (廣播完畢後帶入 textToSay 上下文並自動觸發現場錄音)
 */
function broadcastText(bot, msg, textToSay) {
  const chatId = msg.chat.id;
  const hasChinese = /[\u4e00-\u9fff]/.test(textToSay);
  const voice = hasChinese ? "Sin-Ji" : "Samantha";

  lastSpokenText = textToSay;

  execFile("say", ["-v", voice, textToSay], async (error) => {
    if (error) {
      return execFile("say", [textToSay], async (fallbackErr) => {
        if (fallbackErr) {
          return bot.sendMessage(chatId, `❌ 廣播失敗: ${fallbackErr.message}`);
        }
        await bot.sendMessage(chatId, `🔊 已廣播 (預設語音): "${textToSay}"`);
        // 自動觸發現場錄音 (帶入廣播上下文)
        await recordSkill.startRecordTask(bot, msg, 60, textToSay);
      });
    }

    const langName = hasChinese ? "廣東話" : "英文";
    await bot.sendMessage(
      chatId,
      `🔊 已在 Mac Studio 廣播 (${langName}): "${textToSay}"`,
    );

    // 廣播完畢後自動觸發現場錄音 (帶入廣播上下文)
    await recordSkill.startRecordTask(bot, msg, 60, textToSay);
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
            .sendMessage(chatId, "🗣️ 請輸入你想廣播嘅字句：", {
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
                  bot.unregisterActiveTask(chatId, taskId);
                  broadcastText(bot, replyMsg, replyMsg.text.trim());
                }
              };

              bot.onReplyToMessage(chatId, sentMsg.message_id, replyListener);

              bot.registerActiveTask(chatId, taskId, () => {
                bot.removeListener("message", replyListener);
                bot.sendMessage(chatId, "🛑 語音廣播對話已取消。");
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
          return bot.sendMessage(chatId, "⚠️ 目前沒有可重複嘅上一次廣播紀錄。");
        }

        bot.sendMessage(
          chatId,
          `🔄 正在重複廣播上一次語句：\n"${lastSpokenText}"`,
        );
        broadcastText(bot, msg, lastSpokenText);
      },
    },
  ],
};
