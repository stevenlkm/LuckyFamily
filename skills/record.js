const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 錄音狀態鎖 (防止重複觸發)
let isRecording = false;

module.exports = {
  name: 'Audio Record',
  description: 'Mac 本地環境錄音',
  commands: [
    {
      cmd: 'record',
      desc: '進行 1 分鐘現場環境錄音並傳回 Telegram (別名: /rec)',
      regex: /^\/(record|rec)$/,
      handler: async (bot, msg) => {
        const chatId = msg.chat.id;

        if (isRecording) {
          return bot.sendMessage(chatId, '⚠️ 目前正在進行錄音中，請稍後再試。');
        }

        isRecording = true;
        const tmpFilePath = path.join(os.tmpdir(), `rec_${Date.now()}.m4a`);

        await bot.sendMessage(chatId, '🎙️ 正在進行 1 分鐘現場環境錄音，請稍候...');

        // 使用 macOS 原生 afrecord 指製 60 秒 m4a 音訊
        execFile('afrecord', ['-t', '60', '-f', 'm4af', tmpFilePath], async (error) => {
          try {
            if (error) {
              console.error('錄音失敗:', error);
              return bot.sendMessage(chatId, `❌ 錄音失敗: ${error.message}\n💡 請確認 macOS 已授權 Terminal/Node 存取麥克風。`);
            }

            if (!fs.existsSync(tmpFilePath)) {
              return bot.sendMessage(chatId, '❌ 錄音失敗：找不到錄音檔案。');
            }

            await bot.sendMessage(chatId, '📤 錄音完成，正在傳送語音訊息...');
            
            // 發送語音訊息至 Telegram
            await bot.sendVoice(chatId, tmpFilePath, {
              caption: '🎙️ Mac Studio 1 分鐘現場環境錄音'
            });

          } catch (err) {
            console.error('傳送錄音失敗:', err);
            bot.sendMessage(chatId, `❌ 傳送錄音失敗: ${err.message}`);
          } finally {
            // 自動清理暫存檔
            if (fs.existsSync(tmpFilePath)) {
              fs.unlink(tmpFilePath, (unlinkErr) => {
                if (unlinkErr) console.error('刪除暫存檔失敗:', unlinkErr);
              });
            }
            isRecording = false;
          }
        });
      }
    }
  ]
};