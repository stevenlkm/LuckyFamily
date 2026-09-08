const { execFile } = require("child_process");
const { Worker } = require("worker_threads");
const fs = require("fs");
const path = require("path");
const os = require("os");

let isRecording = false;
let isAiProcessing = false;

// 雙佇列聲明
const recordingQueue = [];
const aiQueue = [];

/**
 * 處理 AI 分析 Task Queue (FIFO 順序執行，一次一個)
 */
function processNextAiTask() {
  if (isAiProcessing || aiQueue.length === 0) return;

  isAiProcessing = true;
  const task = aiQueue.shift();
  const { bot, chatId, tmpFilePath, contextPrompt } = task;

  const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
  const ollamaModel = process.env.OLLAMA_MODEL || "gemma4:12b";
  const workerPath = path.join(__dirname, "aiWorker.js");

  const remainingMsg =
    aiQueue.length > 0 ? ` (隊列剩餘 ${aiQueue.length} 個任務)` : "";
  bot.sendMessage(
    chatId,
    `🤖 正在執行 Ollama (\`${ollamaModel}\`) 對話脈絡分析${remainingMsg}...`,
    { parse_mode: "Markdown" },
  );

  const worker = new Worker(workerPath, {
    workerData: {
      filePath: tmpFilePath,
      ollamaHost,
      ollamaModel,
      contextPrompt,
    },
  });

  const finishTask = () => {
    if (fs.existsSync(tmpFilePath)) {
      try {
        fs.unlinkSync(tmpFilePath);
      } catch (e) {}
    }
    isAiProcessing = false;
    // 遞迴觸發下一個 AI 任務
    processNextAiTask();
  };

  worker.on("message", (result) => {
    if (result.success) {
      const report = `🧠 *Ollama (${ollamaModel}) 對話分析報告*\n\n${result.analysis}`;
      bot.sendMessage(chatId, report, { parse_mode: "Markdown" });
    } else {
      bot.sendMessage(chatId, `⚠️ AI 分析失敗：\n${result.error}`);
    }
    finishTask();
  });

  worker.on("error", (err) => {
    console.error("AI Worker 線程錯誤:", err);
    bot.sendMessage(chatId, `❌ AI 線程發生錯誤: ${err.message}`);
    finishTask();
  });
}

/**
 * 將 AI 任務加入隊列
 */
function enqueueAiTask(bot, chatId, tmpFilePath, contextPrompt) {
  aiQueue.push({ bot, chatId, tmpFilePath, contextPrompt });
  processNextAiTask();
}

/**
 * 處理錄音 Queue
 */
function processNextRecordTask() {
  if (isRecording || recordingQueue.length === 0) return;

  const nextTask = recordingQueue.shift();
  executeRecord(
    nextTask.bot,
    nextTask.msg,
    nextTask.durationSeconds,
    nextTask.contextPrompt,
  );
}

/**
 * 執行實體錄音
 */
function executeRecord(bot, msg, durationSeconds, contextPrompt) {
  isRecording = true;
  const chatId = msg.chat.id;
  const tmpFilePath = path.join(os.tmpdir(), `rec_${Date.now()}.m4a`);
  const swiftScriptPath = path.join(__dirname, "record.swift");

  bot.sendMessage(
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
          bot.sendMessage(
            chatId,
            `❌ 錄音失敗：\n\`${errMsg}\`\n\n💡 *提示*：Mac Studio 主機沒有內建麥克風，請確認已連接外置 USB 麥克風、Webcam 鏡頭、AirPods 或 Studio Display。`,
            { parse_mode: "Markdown" },
          );
        } else if (!fs.existsSync(tmpFilePath)) {
          bot.sendMessage(chatId, "❌ 錄音失敗：找不到錄音檔案。");
        } else {
          const fileStats = fs.statSync(tmpFilePath);
          if (fileStats.size < 2048) {
            if (fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);
            bot.sendMessage(
              chatId,
              "❌ 錄音失敗：錄音檔案長度無效，請確認麥克風收音是否正常。",
            );
          } else {
            await bot.sendMessage(chatId, "📤 錄音完成，正在傳送語音訊息...");

            await bot.sendVoice(chatId, tmpFilePath, {
              caption: `🎙️ Mac Studio ${durationSeconds} 秒現場環境錄音`,
            });

            // 錄音發送成功後，加入 AI 排隊隊列
            enqueueAiTask(bot, chatId, tmpFilePath, contextPrompt);
          }
        }
      } catch (err) {
        console.error("傳送錄音失敗:", err);
        bot.sendMessage(chatId, `❌ 傳送錄音失敗: ${err.message}`);
        if (fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);
      } finally {
        isRecording = false;
        // 自動觸發下一個排隊錄音
        processNextRecordTask();
      }
    },
  );

  // 註冊至 Task Manager，支援 /stop 取消
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
    recordingQueue.length = 0; // 清空排隊錄音
    aiQueue.length = 0; // 清空排隊 AI
    bot.sendMessage(chatId, "🛑 錄音與 AI 分析佇列任務已成功取消。");
  });
}

/**
 * 導出核心錄音任務函數 (自動支援 Queue)
 */
async function startRecordTask(
  bot,
  msg,
  durationSeconds = 60,
  contextPrompt = null,
) {
  if (isRecording) {
    recordingQueue.push({ bot, msg, durationSeconds, contextPrompt });
    return bot.sendMessage(
      msg.chat.id,
      `⏳ 已加入錄音排隊隊列（前面有 ${recordingQueue.length} 個錄音任務）...`,
    );
  }

  executeRecord(bot, msg, durationSeconds, contextPrompt);
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
