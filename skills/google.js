const { execFile } = require("child_process");

/**
 * 執行 Google Voice 語音廣播 (自動帶入 "Hey Google, ")
 */
function broadcastGoogleCommand(bot, chatId, commandText) {
  const fullText = `Hey Google, ${commandText.trim()}`;
  const hasChinese = /[\u4e00-\u9fff]/.test(fullText);
  const voice = hasChinese ? "Sin-Ji" : "Samantha";

  execFile("say", ["-v", voice, fullText], (error) => {
    if (error) {
      return execFile("say", [fullText], (fallbackErr) => {
        if (fallbackErr) {
          return bot.sendMessage(chatId, `❌ 廣播失敗: ${fallbackErr.message}`);
        }
        bot.sendMessage(chatId, `🗣️ 已對 Google Home 廣播: "${fullText}"`);
      });
    }
    bot.sendMessage(chatId, `🗣️ 已對 Google Home 廣播: "${fullText}"`);
  });
}

module.exports = {
  name: "Google Home Voice Control",
  description: "Google Home 語音控制",
  broadcastGoogleCommand,
  commands: [
    {
      cmd: "google",
      desc: "對 Google Home 發出語音指令 (自動帶入 Hey Google)",
      regex: /^\/google(?:\s+(.+))?$/,
      handler: (bot, msg, match) => {
        const chatId = msg.chat.id;
        const textToSay = match[1] ? match[1].trim() : null;

        if (textToSay) {
          // 單行模式
          broadcastGoogleCommand(bot, chatId, textToSay);
        } else {
          // 互動問答模式
          bot
            .sendMessage(
              chatId,
              "🗣️ 請輸入你想傳送比 Google Home 嘅指令 (無需打 Hey Google)：",
              {
                reply_markup: {
                  force_reply: true,
                  selective: true,
                },
              },
            )
            .then((sentMsg) => {
              const taskId = `reply_${sentMsg.message_id}`;

              const replyListener = (replyMsg) => {
                if (replyMsg.from.id !== msg.from.id) return;

                if (replyMsg.text) {
                  bot.unregisterActiveTask(chatId, taskId);
                  broadcastGoogleCommand(bot, chatId, replyMsg.text.trim());
                }
              };

              bot.onReplyToMessage(chatId, sentMsg.message_id, replyListener);

              bot.registerActiveTask(chatId, taskId, () => {
                bot.removeListener("message", replyListener);
                bot.sendMessage(chatId, "🛑 Google 語音指令對話已取消。");
              });
            });
        }
      },
    },
  ],
};
