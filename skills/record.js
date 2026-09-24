const { execFile, exec } = require("child_process");
const { Worker } = require("worker_threads");
const fs = require("fs");
const path = require("path");
const os = require("os");
const logger = require("../utils/logger");

let isRecording = false;
let isAiProcessing = false;

const recordingQueue = [];
const aiQueue = [];

/**
 * 自動偵測優先使用編譯後的 record_bin 還是 swift 腳本
 */
function getRecordExecutable() {
  const binPath = path.join(__dirname, "record_bin");
  const swiftPath = path.join(__dirname, "record.swift");

  if (fs.existsSync(binPath)) {
    return { cmd: binPath, args: [] };
  }
  return { cmd: "swift", args: [swiftPath] };
}

/**
 * 執行實體錄音 (支援 macOS PM2 背景 TCC 麥克風權限 AppleScript 自動穿透)
 */
function runRecordCommand(execInfo, tmpFilePath, durationSeconds, callback) {
  const spawnArgs = [...execInfo.args, tmpFilePath, String(durationSeconds)];
  const fullCmd = `"${execInfo.cmd}" ${spawnArgs.map((a) => `"${a}"`).join(" ")}`;

  // 1. 優先嘗試直接執行
  const childProc = execFile(
    execInfo.cmd,
    spawnArgs,
    (error, stdout, stderr) => {
      const errMsg = (stderr || stdout || error?.message || "").trim();

      // 2. 若偵測到 macOS PM2 背景進程 TCC 麥克風權限阻截，自動啟動 AppleScript 穿透機制
      if (error && errMsg.includes("Microphone access is denied")) {
        logger.warn(
          "RecordSkill",
          "偵測到背景 PM2 麥克風 TCC 權限限制，自動啟用 AppleScript 穿透機制...",
        );

        // 使用 osascript 轉交 Terminal (系統設定中已獲授權) 代為執行
        const osaCmd = `osascript -e 'tell application "Terminal" to do script "${fullCmd.replace(/"/g, '\\"')}"'`;

        exec(osaCmd, (osaErr) => {
          if (osaErr) {
            logger.error("RecordSkill", "AppleScript 穿透執行失敗", osaErr);
            return callback(error, stdout, stderr, childProc);
          }

          // 輪詢等待錄音檔案生成
          const checkInterval = 500;
          const maxWaitTime = (durationSeconds + 5) * 1000;
          let elapsed = 0;

          const timer = setInterval(() => {
            elapsed += checkInterval;
            if (fs.existsSync(tmpFilePath)) {
              try {
                const stats = fs.statSync(tmpFilePath);
                if (stats.size > 2048) {
                  clearInterval(timer);
                  logger.info(
                    "RecordSkill",
                    `AppleScript 穿透錄音成功！檔案大小: ${stats.size} bytes`,
                  );
                  return callback(null, "RECORDING_SUCCESS", "", childProc);
                }
              } catch (e) {}
            }

            if (elapsed >= maxWaitTime) {
              clearInterval(timer);
              logger.error(
                "RecordSkill",
                "AppleScript 穿透錄音超時，未取得有效音訊檔",
              );
              return callback(error, stdout, stderr, childProc);
            }
          }, checkInterval);
        });

        return;
      }

      callback(error, stdout, stderr, childProc);
    },
  );

  return childProc;
}

/**
 * 處理 AI 分析 Task Queue (FIFO 順序執行)
 */
function processNextAiTask() {
  if (isAiProcessing || aiQueue.length === 0) return;

  isAiProcessing = true;
  const task = aiQueue.shift();
  const { bot, chatId, tmpFilePath, contextPrompt } = task;

  const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
  const ollamaModel = process.env.OLLAMA_MODEL || "gemma4:12b";
  const workerPath = path.join(__dirname, "aiWorker.js");

  logger.task(
    chatId,
    "ai",
    `啟動 Worker Thread 進行 Ollama (${ollamaModel}) 分析...`,
  );
  const remainingMsg =
    aiQueue.length > 0 ? ` (隊列剩餘 ${aiQueue.length} 個任務)` : "";
  bot.safeSendMessage(
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
    processNextAiTask();
  };

  worker.on("message", async (result) => {
    if (result.success) {
      logger.info("RecordSkill", `Ollama (${ollamaModel}) AI 分析成功完成`);
      const report = `🧠 *Ollama (${ollamaModel}) 對話分析報告*\n\n${result.analysis}`;
      await bot.safeSendMessage(chatId, report, { parse_mode: "Markdown" });
    } else {
      logger.error("RecordSkill", `AI 分析失敗: ${result.error}`);
      await bot.safeSendMessage(chatId, `⚠️ AI 分析失敗：\n${result.error}`);
    }
    finishTask();
  });

  worker.on("error", (err) => {
    logger.error("RecordSkill", "AI Worker 線程發生異常", err);
    bot.safeSendMessage(chatId, `❌ AI 線程發生錯誤: ${err.message}`);
    finishTask();
  });
}

function enqueueAiTask(bot, chatId, tmpFilePath, contextPrompt) {
  aiQueue.push({ bot, chatId, tmpFilePath, contextPrompt });
  processNextAiTask();
}

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

function executeRecord(bot, msg, durationSeconds, contextPrompt) {
  isRecording = true;
  const chatId = msg.chat.id;
  const tmpFilePath = path.join(os.tmpdir(), `rec_${Date.now()}.m4a`);
  const execInfo = getRecordExecutable();

  logger.task(
    chatId,
    "record",
    `開始執行 ${durationSeconds} 秒現場環境錄音 (指令: ${execInfo.cmd})`,
  );
  bot.safeSendMessage(
    chatId,
    `🎙️ 正在進行 ${durationSeconds} 秒現場環境錄音，請稍候...`,
  );

  const childProc = runRecordCommand(
    execInfo,
    tmpFilePath,
    durationSeconds,
    async (error, stdout, stderr, proc) => {
      bot.unregisterActiveTask(chatId, "record");

      try {
        if (error) {
          const errMsg = (stderr || stdout || error.message).trim();
          logger.error("RecordSkill", `錄音腳本失敗: ${errMsg}`, error);

          if (fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);

          bot.safeSendMessage(
            chatId,
            `❌ 錄音失敗：\n\`${errMsg}\`\n\n💡 *排查指引*：請於 Mac 系統設定 -> 隱私權與安全性 -> 咪高風 確保「終端機.app」為開啟狀態。`,
            { parse_mode: "Markdown" },
          );
        } else if (!fs.existsSync(tmpFilePath)) {
          logger.error(
            "RecordSkill",
            `錄音腳本結束，但找不到輸出檔案: ${tmpFilePath}`,
          );
          bot.safeSendMessage(chatId, "❌ 錄音失敗：找不到錄音檔案。");
        } else {
          const fileStats = fs.statSync(tmpFilePath);
          logger.info(
            "RecordSkill",
            `錄音成功完成，檔案大小: ${fileStats.size} bytes`,
          );

          if (fileStats.size < 2048) {
            logger.warn("RecordSkill", "錄音檔案體積小於 2KB，判定為無效聲音");
            if (fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);
            bot.safeSendMessage(
              chatId,
              "❌ 錄音失敗：錄音檔案長度無效，請確認麥克風收音是否正常。",
            );
          } else {
            await bot.safeSendMessage(
              chatId,
              "📤 錄音完成，正在傳送語音訊息...",
            );

            await bot.sendVoice(chatId, tmpFilePath, {
              caption: `🎙️ Mac Studio ${durationSeconds} 秒現場環境錄音`,
            });

            enqueueAiTask(bot, chatId, tmpFilePath, contextPrompt);
          }
        }
      } catch (err) {
        logger.error("RecordSkill", "傳送語音訊息至 Telegram 失敗", err);
        bot.safeSendMessage(chatId, `❌ 傳送錄音失敗: ${err.message}`);
        if (fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);
      } finally {
        isRecording = false;
        processNextRecordTask();
      }
    },
  );

  bot.registerActiveTask(chatId, "record", () => {
    try {
      if (childProc) childProc.kill("SIGKILL");
    } catch (e) {}
    if (fs.existsSync(tmpFilePath)) {
      try {
        fs.unlinkSync(tmpFilePath);
      } catch (e) {}
    }
    isRecording = false;
    recordingQueue.length = 0;
    aiQueue.length = 0;
    logger.warn(
      "RecordSkill",
      `用戶 [Chat:${chatId}] 取消了錄音與 AI 佇列任務`,
    );
    bot.safeSendMessage(chatId, "🛑 錄音與 AI 分析佇列任務已成功取消。");
  });
}

async function startRecordTask(
  bot,
  msg,
  durationSeconds = 60,
  contextPrompt = null,
) {
  if (isRecording) {
    recordingQueue.push({ bot, msg, durationSeconds, contextPrompt });
    logger.info(
      "RecordSkill",
      `當前正在錄音，任務已加入佇列 (排隊數: ${recordingQueue.length})`,
    );
    return bot.safeSendMessage(
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
