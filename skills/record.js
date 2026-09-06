const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

let isRecording = false;

module.exports = {
  name: "Audio Record",
  description: "Mac 本地環境錄音",
  commands: [
    {
      cmd: "record",
      desc: "進行 1 分鐘現場環境錄音並傳回 Telegram (別名: /rec)",
      regex: /^\/(record|rec)$/,
      handler: async (bot, msg) => {
        const chatId = msg.chat.id;

        if (isRecording) {
          return bot.sendMessage(chatId, "⚠️ 目前正在進行錄音中，請稍後再試。");
        }

        isRecording = true;
        const tmpFilePath = path.join(os.tmpdir(), `rec_${Date.now()}.m4a`);
        const swiftScriptPath = path.join(__dirname, "record.swift");

        await bot.sendMessage(
          chatId,
          "🎙️ 正在進行 1 分鐘現場環境錄音，請稍候...",
        );

        // 呼叫 Swift 腳本進行錄音
        execFile(
          "swift",
          [swiftScriptPath, tmpFilePath, "60"],
          async (error, stdout, stderr) => {
            try {
              if (error) {
                const errMsg = (stderr || stdout || error.message).trim();
                console.error("錄音失敗:", errMsg);
                return bot.sendMessage(
                  chatId,
                  `❌ 錄音失敗：\n\`${errMsg}\`\n\n💡 *提示*：Mac Studio 主機沒有內建麥克風，請確認已連接外置 USB 麥克風、Webcam 鏡頭、AirPods 或 Studio Display。`,
                  { parse_mode: "Markdown" },
                );
              }

              if (!fs.existsSync(tmpFilePath)) {
                return bot.sendMessage(chatId, "❌ 錄音失敗：找不到錄音檔案。");
              }

              // 雙重檢查檔案大小 (避免傳送 00:00 無效語音)
              const fileStats = fs.statSync(tmpFilePath);
              if (fileStats.size < 2048) {
                return bot.sendMessage(
                  chatId,
                  "❌ 錄音失敗：錄音檔案長度無效，請確認麥克風收音是否正常。",
                );
              }

              await bot.sendMessage(chatId, "📤 錄音完成，正在傳送語音訊息...");

              // 發送語音訊息至 Telegram
              await bot.sendVoice(chatId, tmpFilePath, {
                caption: "🎙️ Mac Studio 1 分鐘現場環境錄音",
              });
            } catch (err) {
              console.error("傳送錄音失敗:", err);
              bot.sendMessage(chatId, `❌ 傳送錄音失敗: ${err.message}`);
            } finally {
              if (fs.existsSync(tmpFilePath)) {
                fs.unlink(tmpFilePath, (unlinkErr) => {
                  if (unlinkErr) console.error("刪除暫存檔失敗:", unlinkErr);
                });
              }
              isRecording = false;
            }
          },
        );
      },
    },
  ],
};
