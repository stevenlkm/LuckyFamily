const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// 從環境變數安全讀取帳密並進行 URL 安全編碼
const cctvUser = encodeURIComponent(process.env.CCTV_USER || "admin");
const cctvPass = encodeURIComponent(process.env.CCTV_PASS || "");

// 動態組裝鏡頭設定清單
const CAMERAS = {
  living_room: {
    name: process.env.CCTV_CAM_LIVING_ROOM_NAME || "客廳 (Tapo)",
    rtspUrl: `rtsp://${cctvUser}:${cctvPass}@${process.env.CCTV_CAM_LIVING_ROOM_HOST || "192.168.9.248:554/stream1"}`,
  },
};

/**
 * 使用 ffmpeg 抓取 RTSP 即時單張截圖
 */
function captureRtspSnapshot(bot, chatId, camKey) {
  const camInfo = CAMERAS[camKey];
  if (!camInfo) {
    return bot.sendMessage(chatId, "❌ 找不到指定的 CCTV 鏡頭設定。");
  }

  const tmpFilePath = path.join(
    os.tmpdir(),
    `cctv_${camKey}_${Date.now()}.jpg`,
  );
  const taskId = `cctv_${Date.now()}`;

  bot.sendMessage(chatId, `📸 正在抓取【${camInfo.name}】即時畫面，請稍候...`);

  // ffmpeg 指令：抓取 1 幀 JPEG 高清圖片
  const ffmpegArgs = [
    "-rtsp_transport",
    "tcp",
    "-y",
    "-i",
    camInfo.rtspUrl,
    "-vframes",
    "1",
    "-q:v",
    "2",
    tmpFilePath,
  ];

  const childProc = execFile(
    "ffmpeg",
    ffmpegArgs,
    async (error, stdout, stderr) => {
      bot.unregisterActiveTask(chatId, taskId);

      try {
        if (error) {
          console.error("CCTV 抓圖失敗:", stderr || error.message);
          return bot.sendMessage(
            chatId,
            `❌ 抓取【${camInfo.name}】畫面失敗: 網絡連線超時或 RTSP 端點不正確。`,
          );
        }

        if (!fs.existsSync(tmpFilePath)) {
          return bot.sendMessage(chatId, "❌ 抓圖失敗：找不到截圖檔案。");
        }

        // 發送照片至 Telegram
        await bot.sendPhoto(chatId, tmpFilePath, {
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
  CAMERAS,
  captureRtspSnapshot,
  commands: [
    {
      cmd: "cctv",
      desc: "獲取即時 CCTV 截圖 (別名: /cam)",
      regex: /^\/(cctv|cam)(?:\s+(.+))?$/,
      handler: (bot, msg, match) => {
        const chatId = msg.chat.id;
        const targetCam = match[2] ? match[2].trim().toLowerCase() : null;

        if (targetCam && CAMERAS[targetCam]) {
          captureRtspSnapshot(bot, chatId, targetCam);
        } else {
          // 彈出鏡頭選擇選單
          const inlineKeyboard = Object.keys(CAMERAS).map((key) => [
            { text: `📷 ${CAMERAS[key].name}`, callback_data: `cctv_${key}` },
          ]);

          bot.sendMessage(chatId, "📹 *請選擇要查看嘅 CCTV 鏡頭：*", {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: inlineKeyboard,
            },
          });
        }
      },
    },
  ],
};
