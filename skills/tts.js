const { execFile } = require('child_process');

module.exports = {
  name: 'TTS Broadcast',
  description: 'Mac 本地語音廣播',
  commands: [
    {
      cmd: 'say <內容>',
      desc: '廣播語音 (自動識別廣東話/英文)',
      regex: /\/(say|broadcast)\s+(.+)/,
      handler: (bot, msg, match) => {
        const textToSay = match[2].trim();
        if (!textToSay) return;

        const hasChinese = /[\u4e00-\u9fff]/.test(textToSay);
        const voice = hasChinese ? 'Sin-Ji' : 'Samantha';

        execFile('say', ['-v', voice, textToSay], (error) => {
          if (error) {
            return execFile('say', [textToSay], (fallbackErr) => {
              if (fallbackErr) {
                return bot.sendMessage(msg.chat.id, `❌ 廣播失敗: ${fallbackErr.message}`);
              }
              bot.sendMessage(msg.chat.id, `🔊 已廣播 (預設語音): "${textToSay}"`);
            });
          }

          const langName = hasChinese ? '廣東話' : '英文';
          bot.sendMessage(msg.chat.id, `🔊 已在 Mac Studio 廣播 (${langName}): "${textToSay}"`);
        });
      }
    }
  ]
};