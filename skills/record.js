const { execFile } = require("child_process");
const { Worker } = require("worker_threads");
const fs = require("fs");
const path = require("path");
const os = require("os");

let isRecording = false;

/**
 * 啟動多線程 AI 分析 Worker Thread (不卡住 Node.js 主線程)
 */
function runAiAnalysisWorker(bot, chatId, tmpFilePath) {
  const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
  const ollamaModel = process.env.OLLAMA_MODEL || "gemma4:12b";
  const workerPath = path.join(__dirname, "aiWorker.js");

  bot.sendMessage(
    chatId,
    `🤖 已啟動背景 AI 多線程 (Worker Thread)，正使用 Ollama (\`${ollamaModel}\`) 分析錄音...`,
    { parse_mode: "Markdown" },
  );

  const worker = new Worker(workerPath, {
    workerData: {
      filePath: tmpFilePath,
      ollamaHost,
      ollamaModel,
    },
  });

  worker.on("message", (result) => {
    if (result.success) {
      const report = `🧠 *Ollama (${ollamaModel}) 現場錄音分析報告*\n\n${result.analysis}`;
      bot.sendMessage(chatId, report, { parse_mode: "Markdown" });
    } else {
      bot.sendMessage(chatId, `⚠️ AI 分析失敗：\n${result.error}`);
    }

    // AI Worker 完成後清理錄音暫存檔
    if (fs.existsSync(tmpFilePath)) {
      fs.unlink(tmpFilePath, () => {});
    }
  });

  worker.on("error", (err) => {
    console.error("AI Worker 線程錯誤:", err);
    bot.sendMessage(chatId, `❌ AI 線程發生錯誤: ${err.message}`);
    if (fs.existsSync(tmpFilePath)) {
      fs.unlink(tmpFilePath, () => {});
    }
  });
}

/**
 * 導出核心錄音任務函數
 */
async function startRecordTask(bot, msg, durationSeconds = 60) {
  const chatId = msg.chat.id;

  if (isRecording) {
    return bot.sendMessage(chatId, "⚠️ 目前正在進行錄音中，請稍後再試。");
  }

  isRecording = true;
  const tmpFilePath = path.join(os.tmpdir(), `rec_${Date.now()}.m4a`);
  const swiftScriptPath = path.join(__dirname, "record.swift");

  await bot.sendMessage(
    chatId,
    `🎙️ 正在進行 ${durationSeconds} 秒現場環境錄音，請稍候...`,
  );

  const childProc = execFile(
    "swift",
    [swiftScriptPath, tmpFilePath, String(durationSeconds)],
    async (error, stdout, stderr) => {
      bot.unregisterActiveTask(chatId, "record");

      try {
        if (error) {
          const errMsg = (stderr || stdout || error.message).trim();
          console.error("錄音失敗:", errMsg);
          if (fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);
          isRecording = false;
          return bot.sendMessage(
            chatId,
            `❌ 錄音失敗：\n\`${errMsg}\`\n\n💡 *提示*：Mac Studio 主機沒有內建麥克風，請確認已連接外置 USB 麥克風、Webcam 鏡頭、AirPods 或 Studio Display。`,
            { parse_mode: "Markdown" },
          );
        }

        if (!fs.existsSync(tmpFilePath)) {
          isRecording = false;
          return bot.sendMessage(chatId, "❌ 錄音失敗：找不到錄音檔案。");
        }

        const fileStats = fs.statSync(tmpFilePath);
        if (fileStats.size < 2048) {
          if (fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);
          isRecording = false;
          return bot.sendMessage(
            chatId,
            "❌ 錄音失敗：錄音檔案長度無效，請確認麥克風收音是否正常。",
          );
        }

        await bot.sendMessage(chatId, "📤 錄音完成，正在傳送語音訊息...");

        // 1. 發送語音訊息至 Telegram
        await bot.sendVoice(chatId, tmpFilePath, {
          caption: `🎙️ Mac Studio ${durationSeconds} 秒現場環境錄音`,
        });

        isRecording = false;

        // 2. 開闢獨立 Worker Thread 進行 Ollama (gemma4:12b) AI 分析
        runAiAnalysisWorker(bot, chatId, tmpFilePath);
      } catch (err) {
        console.error("傳送錄音失敗:", err);
        bot.sendMessage(chatId, `❌ 傳送錄音失敗: ${err.message}`);
        if (fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);
        isRecording = false;
      }
    },
  );

  // 註冊至全局 Task Manager，支援 /stop 中斷
  bot.registerActiveTask(chatId, "record", () => {
    try {
      childProc.kill("SIGKILL");
    } catch (e) {}
    if (fs.existsSync(tmpFilePath)) {
      try {
        fs.unlinkSync(tmpFilePath);
      } catch (e) {}
    }
    isRecording = false;
    bot.sendMessage(chatId, "🛑 錄音操作已成功取消。");
  });
}

module.exports = {
  name: "Audio Record",
  description: "Mac 本地環境錄音",
  startRecordTask,
  commands: [
    {
      cmd: "record",
      desc: "進行 1 分鐘現場環境錄音、發送語音訊息並觸發 Ollama AI 對話分析 (別名: /rec)",
      regex: /^\/(record|rec)$/,
      handler: async (bot, msg) => {
        await startRecordTask(bot, msg, 60);
      },
    },
  ],
};
