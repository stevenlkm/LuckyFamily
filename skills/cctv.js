const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * 動態讀取環境變數並組裝 Tapo C245D 雙鏡頭 (廣角 + 追蹤) RTSP 串流設定
 */
function getCameras() {
  const cctvUser = encodeURIComponent(process.env.CCTV_USER || "admin");
  const cctvPass = encodeURIComponent(process.env.CCTV_PASS || "");
  const cctvIp = process.env.CCTV_IP || "192.168.9.248";
  const cctvPort = process.env.CCTV_PORT || "554";

  return {
    stream1: {
      name: process.env.CCTV_STREAM1_NAME || "廣角 (高清 2K - Stream 1)",
      rtspUrl: `rtsp://${cctvUser}:${cctvPass}@${cctvIp}:${cctvPort}/stream1`,
    },
    stream2: {
      name: process.env.CCTV_STREAM2_NAME || "廣角 (流暢 720P - Stream 2)",
      rtspUrl: `rtsp://${cctvUser}:${cctvPass}@${cctvIp}:${cctvPort}/stream2`,
    },
    stream6: {
      name: process.env.CCTV_STREAM6_NAME || "追蹤 (高清 2K - Stream 6)",
      rtspUrl: `rtsp://${cctvUser}:${cctvPass}@${cctvIp}:${cctvPort}/stream6`,
    },
    stream7: {
      name: process.env.CCTV_STREAM7_NAME || "追蹤 (流暢 720P - Stream 7)",
      rtspUrl: `rtsp://${cctvUser}:${cctvPass}@${cctvIp}:${cctvPort}/stream7`,
    },
  };
}

/**
 * 自動偵測 macOS 上 ffmpeg 的絕對路徑
 */
function getFfmpegBin() {
  if (fs.existsSync("/opt/homebrew/bin/ffmpeg"))
    return "/opt/homebrew/bin/ffmpeg";
  if (fs.existsSync("/usr/local/bin/ffmpeg")) return "/usr/local/bin/ffmpeg";
  return "ffmpeg";
}

/**
 * 使用 ffmpeg 抓取 RTSP 即時單張截圖
 */
function captureRtspSnapshot(bot, chatId, camKey) {
  const CAMERAS = getCameras();
  const camInfo = CAMERAS[camKey];

  if (!camInfo) {
    return bot.sendMessage(chatId, "❌ 找不到指定的 CCTV 串流設定。");
  }

  const tmpFilePath = path.join(
    os.tmpdir(),
    `cctv_${camKey}_${Date.now()}.jpg`,
  );
  const taskId = `cctv_${Date.now()}`;
  const ffmpegBin = getFfmpegBin();

  bot.sendMessage(chatId, `📸 正在抓取【${camInfo.name}】即時畫面，請稍候...`);

  // FFmpeg 9.0+ 相容參數 (-timeout 5000000 及 -update 1)
  const ffmpegArgs = [
    "-rtsp_transport",
    "tcp",
    "-timeout",
    "5000000",
    "-y",
    "-i",
    camInfo.rtspUrl,
    "-vframes",
    "1",
    "-update",
    "1",
    "-q:v",
    "2",
    tmpFilePath,
  ];

  const childProc = execFile(
    ffmpegBin,
    ffmpegArgs,
    { timeout: 10000 },
    async (error, stdout, stderr) => {
      bot.unregisterActiveTask(chatId, taskId);

      try {
        if (error) {
          console.error("CCTV 抓圖失敗:", stderr || error.message);
          return bot.sendMessage(
            chatId,
            `❌ 抓取【${camInfo.name}】畫面失敗！\n\n原因：RTSP 連線超時或 IP/密碼不正確。\n💡 請檢查 \`.env\` 內 \`CCTV_USER\` / \`CCTV_PASS\` 及 \`CCTV_IP\` 設定。`,
          );
        }

        if (!fs.existsSync(tmpFilePath)) {
          return bot.sendMessage(chatId, "❌ 抓圖失敗：找不到截圖檔案。");
        }

        // 使用 fs.createReadStream 確保二進制流 100% 成功傳送至 Telegram
        await bot.sendPhoto(chatId, fs.createReadStream(tmpFilePath), {
          caption: `📹 *${camInfo.name}* 即時截圖\n⏰ 抓取時間: ${new Date().toLocaleString("zh-HK")}`,
          parse_mode: "Markdown",
        });
      } catch (err) {
        console.error("傳送 CCTV 照片失敗:", err);
        bot.sendMessage(chatId, `❌ 傳送照片失敗: ${err.message}`);
      } finally {
        if (fs.existsSync(tmpFilePath)) {
          fs.unlink(tmpFilePath, () => {});
        }
      }
    },
  );

  // 註冊至 Task Manager，支援 /stop 中斷
  bot.registerActiveTask(chatId, taskId, () => {
    try {
      childProc.kill("SIGKILL");
    } catch (e) {}
    if (fs.existsSync(tmpFilePath)) {
      try {
        fs.unlinkSync(tmpFilePath);
      } catch (e) {}
    }
    bot.sendMessage(chatId, "🛑 CCTV 抓圖已被取消。");
  });
}

module.exports = {
  name: "CCTV Camera",
  description: "家居 CCTV 即時畫面抓取",
  getCameras,
  captureRtspSnapshot,
  commands: [
    {
      cmd: "cctv",
      desc: "獲取即時 CCTV 截圖 (別名: /cam, 支援 Tapo C245D 廣角/追蹤雙鏡頭)",
      regex: /^\/(cctv|cam)(?:\s+(.+))?$/,
      handler: (bot, msg, match) => {
        const chatId = msg.chat.id;
        const targetCam = match[2] ? match[2].trim().toLowerCase() : null;
        const CAMERAS = getCameras();

        if (targetCam && CAMERAS[targetCam]) {
          captureRtspSnapshot(bot, chatId, targetCam);
        } else {
          // 2x2 按鈕矩陣：廣角鏡頭 (stream1/2) + 追蹤鏡頭 (stream6/7)
          const inlineKeyboard = [
            [
              {
                text: `📷 ${CAMERAS["stream1"].name}`,
                callback_data: "cctv_stream1",
              },
              {
                text: `📷 ${CAMERAS["stream2"].name}`,
                callback_data: "cctv_stream2",
              },
            ],
            [
              {
                text: `🎯 ${CAMERAS["stream6"].name}`,
                callback_data: "cctv_stream6",
              },
              {
                text: `🎯 ${CAMERAS["stream7"].name}`,
                callback_data: "cctv_stream7",
              },
            ],
          ];

          bot.sendMessage(
            chatId,
            "📹 *請選擇要查看嘅 Tapo C245D 鏡頭與畫質：*",
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: inlineKeyboard,
              },
            },
          );
        }
      },
    },
  ],
};
