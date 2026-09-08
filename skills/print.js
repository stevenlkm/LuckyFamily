const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * 檢查檔案是否為圖片格式
 */
function isImageFile(fileName) {
  if (!fileName) return false;
  const ext = path.extname(fileName).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".heic", ".bmp", ".tiff", ".webp"].includes(
    ext,
  );
}

/**
 * 使用 macOS 原生 sips 工具將圖片轉換為 PDF
 */
function convertImageToPdf(imagePath) {
  return new Promise((resolve, reject) => {
    const pdfPath = `${imagePath}_converted.pdf`;
    execFile(
      "sips",
      ["-s", "format", "pdf", imagePath, "--out", pdfPath],
      (error, stdout, stderr) => {
        if (error) {
          return reject(
            new Error(`圖片轉 PDF 失敗: ${stderr || error.message}`),
          );
        }
        if (!fs.existsSync(pdfPath)) {
          return reject(new Error("圖片轉 PDF 失敗：未生成 PDF 檔案。"));
        }
        resolve(pdfPath);
      },
    );
  });
}

/**
 * 安全清理暫存檔案
 */
function cleanupTempFiles(filePaths) {
  filePaths.forEach((filePath) => {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {}
    }
  });
}

/**
 * 執行檔案下載、格式轉換與 macOS lp 雙面彩色列印
 */
async function printFile(bot, chatId, fileId, originalName) {
  let downloadPath = null;
  let printTargetPath = null;
  let convertedPdfCreated = false;

  try {
    await bot.sendMessage(chatId, `⏳ 正在下載檔案：\`${originalName}\`...`, {
      parse_mode: "Markdown",
    });

    // 下載檔案至暫存目錄
    downloadPath = await bot.downloadFile(fileId, os.tmpdir());
    printTargetPath = downloadPath;

    // ⚠️ 關鍵修復：若為圖片格式，呼叫 macOS 原生 sips 自動轉為標準 PDF，解決 CUPS 圖片列印靜默失敗問題
    if (isImageFile(originalName) || isImageFile(downloadPath)) {
      await bot.sendMessage(
        chatId,
        "🎨 偵測到圖片格式，正使用 macOS 原生引擎轉碼為標準 PDF...",
      );
      printTargetPath = await convertImageToPdf(downloadPath);
      convertedPdfCreated = true;
    }

    await bot.sendMessage(
      chatId,
      "🖨️ 正在傳送至 Mac 印表機進行【雙面彩色列印】...",
    );

    // 呼叫 macOS 原生 lp 指令 (-o fit-to-page 確保圖片/PDF 自動縮放符合紙張大小)
    const lpArgs = [
      "-o",
      "sides=two-sided-long-edge",
      "-o",
      "ColorModel=Color",
      "-o",
      "fit-to-page",
      printTargetPath,
    ];

    const childProc = execFile("lp", lpArgs, async (error, stdout, stderr) => {
      bot.unregisterActiveTask(chatId, "print");

      // 清理下載與轉換的暫存檔
      cleanupTempFiles([
        downloadPath,
        convertedPdfCreated ? printTargetPath : null,
      ]);

      if (error) {
        console.error("列印失敗:", error);
        return bot.sendMessage(
          chatId,
          `❌ 列印失敗: ${stderr || error.message}\n💡 請確認 Mac Studio 已連接印表機，且印表機狀態正常、紙張充裕。`,
        );
      }

      bot.sendMessage(
        chatId,
        `✅ 檔案已成功傳送至印表機列印佇列！\n📄 檔名：\`${originalName}\`\n🎨 模式：雙面彩色 (適合頁面大小)`,
        { parse_mode: "Markdown" },
      );
    });

    // 註冊至 Task Manager，支援 /stop 取消
    bot.registerActiveTask(chatId, "print", () => {
      try {
        childProc.kill("SIGKILL");
      } catch (e) {}
      cleanupTempFiles([
        downloadPath,
        convertedPdfCreated ? printTargetPath : null,
      ]);
      bot.sendMessage(chatId, "🛑 列印操作已被用戶取消。");
    });
  } catch (err) {
    console.error("下載或處理檔案失敗:", err);
    cleanupTempFiles([
      downloadPath,
      convertedPdfCreated ? printTargetPath : null,
    ]);
    bot.sendMessage(chatId, `❌ 處理檔案失敗: ${err.message}`);
  }
}

module.exports = {
  name: "Document Printer",
  description: "Mac 本地文件列印",
  commands: [
    {
      cmd: "print",
      desc: "雙面彩色列印文件 (支援 PDF / 圖片 / 文件)",
      regex: /^\/print(?:\s+.*)?$/,
      handler: (bot, msg) => {
        const chatId = msg.chat.id;

        // 檢查訊息是否直接附帶檔案 (例如上傳文件時 Caption 寫 /print)
        let fileId = null;
        let fileName = "printed_document";

        if (msg.document) {
          fileId = msg.document.file_id;
          fileName = msg.document.file_name || "document.pdf";
        } else if (msg.photo && msg.photo.length > 0) {
          fileId = msg.photo[msg.photo.length - 1].file_id;
          fileName = "photo.jpg";
        }

        if (fileId) {
          // 模式 2：直接夾帶檔案列印
          printFile(bot, chatId, fileId, fileName);
        } else {
          // 模式 1：詢問並等待用戶上傳檔案
          bot
            .sendMessage(
              chatId,
              "🖨️ 請傳送你想列印嘅檔案 (PDF / 圖片 / 文件)：",
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

                let targetFileId = null;
                let targetFileName = "document";

                if (replyMsg.document) {
                  targetFileId = replyMsg.document.file_id;
                  targetFileName =
                    replyMsg.document.file_name || "document.pdf";
                } else if (replyMsg.photo && replyMsg.photo.length > 0) {
                  targetFileId =
                    replyMsg.photo[replyMsg.photo.length - 1].file_id;
                  targetFileName = "photo.jpg";
                }

                if (targetFileId) {
                  const trimmed = (replyMsg.text || "").trim();

                  // 若回覆為 Telegram 指令 (如 /cancel, /stop)，自動退出
                  if (trimmed.startsWith("/")) {
                    bot.unregisterActiveTask(chatId, taskId);
                    return;
                  }

                  bot.unregisterActiveTask(chatId, taskId);
                  printFile(bot, chatId, targetFileId, targetFileName);
                } else {
                  bot.sendMessage(
                    chatId,
                    "⚠️ 未偵測到有效檔案，請傳送 PDF、文件或圖片。",
                  );
                }
              };

              bot.onReplyToMessage(chatId, sentMsg.message_id, replyListener);

              // 註冊對話等待至 Task Manager
              bot.registerActiveTask(chatId, taskId, () => {
                bot.removeListener("message", replyListener);
                bot.sendMessage(chatId, "🛑 列印對話已被取消。");
              });
            });
        }
      },
    },
  ],
};
