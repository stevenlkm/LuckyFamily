const { execFile } = require('child_process');

/**
 * 核心廣播功能
 */
function broadcastText(bot, chatId, textToSay) {
  const hasChinese = /[\u4e00-\u9fff]/.test(textToSay);
  const voice = hasChinese ? 'Sin-Ji' : 'Samantha';

  execFile('say', ['-v', voice, textToSay], (error) => {
    if (error) {
      return execFile('say', [textToSay], (fallbackErr) => {
        if (fallbackErr) {
          return bot.sendMessage(chatId, `❌ 廣播失敗: ${fallbackErr.message}`);
        }
        bot.sendMessage(chatId, `🔊 已廣播 (預設語音): "${textToSay}"`);
      });
    }

    const langName = hasChinese ? '廣東話' : '英文';
    bot.sendMessage(chatId, `🔊 已在 Mac Studio 廣播 (${langName}): "${textToSay}"`);
  });
}

module.exports = {
  name: 'TTS Broadcast',
  description: 'Mac 本地語音廣播',
  commands: [
    {
      cmd: 'say',
      desc: '廣播語音 (支援單行 `/say 內容` 或 分步輸入)',
      // 更新 Regex，令後方的文字變為 Optional
      regex: /^\/(say|broadcast)(?:\s+(.+))?$/,
      handler: (bot, msg, match) => {
        const textToSay = match[2] ? match[2].trim() : null;

        if (textToSay) {
          // 模式 2: 單行直接輸入 (例如: /say 快啲食野)
          broadcastText(bot, msg.chat.id, textToSay);
        } else {
          // 模式 1: 只輸入了 /say，需要進一步對話詢問
          bot.sendMessage(msg.chat.id, '🗣️ 請輸入你想廣播嘅字句：', {
            reply_markup: {
              force_reply: true, // 強制用戶回覆此訊息
              selective: true    // 只針對觸發指令的用戶
            }
          }).then((sentMsg) => {
            // 監聽對這條特定訊息的回覆
            bot.onReplyToMessage(msg.chat.id, sentMsg.message_id, (replyMsg) => {
              // 安全檢查：確保回覆者與發起指令者是同一人
              if (replyMsg.from.id !== msg.from.id) return;
              
              if (replyMsg.text) {
                broadcastText(bot, replyMsg.chat.id, replyMsg.text.trim());
              }
            });
          });
        }
      }
    }
  ]
};