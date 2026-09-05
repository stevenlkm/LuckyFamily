require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');

const token = process.env.TELEGRAM_BOT_TOKEN;

// 解析白名單 ID 陣列 (支援多個 Telegram User ID)
const allowedIds = (process.env.ALLOWED_TELEGRAM_IDS || '')
  .split(',')
  .map(id => Number(id.trim()))
  .filter(id => !isNaN(id) && id > 0);

if (!token) {
  console.error('❌ 錯誤：未在 .env 設定 TELEGRAM_BOT_TOKEN！');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log('🤖 家居遙控 Telegram Bot 已成功啟動...');
console.log(`🔒 已載入白名單 ID 數量: ${allowedIds.length} [${allowedIds.join(', ')}]`);

/**
 * 檢查發送者是否在白名單內
 */
function isAuthorized(msg) {
  const userId = msg.from ? msg.from.id : null;
  
  if (allowedIds.length > 0 && !allowedIds.includes(userId)) {
    console.warn(`⚠️ [拒絕存取] 未授權用戶嘗試連線 - ID: ${userId}, Username: @${msg.from?.username || 'N/A'}`);
    bot.sendMessage(msg.chat.id, '⛔ 存取被拒絕：你的 Telegram ID 不在白名單內。');
    return false;
  }
  return true;
}

// 預設說明選單
bot.onText(/\/start|\/help/, (msg) => {
  if (!isAuthorized(msg)) return;

  const helpMsg = `
🏠 *家居遙控系統 (Home Control)*

歡迎，${msg.from.first_name}！請選擇遠距指令：

🔹 /status - 檢查伺服器與設備運作狀態
🔹 /cmd <指令> - 執行系統 Shell 指令 (如重啟服務)
🔹 /ping - 測試 Bot 連線狀態
  `;

  bot.sendMessage(msg.chat.id, helpMsg, { parse_mode: 'Markdown' });
});

// Ping 測試
bot.onText(/\/ping/, (msg) => {
  if (!isAuthorized(msg)) return;
  bot.sendMessage(msg.chat.id, '🏓 Pong! 家居系統連線正常。');
});

// 檢查伺服器狀態
bot.onText(/\/status/, (msg) => {
  if (!isAuthorized(msg)) return;

  exec('uptime', (error, stdout) => {
    if (error) {
      return bot.sendMessage(msg.chat.id, `❌ 取得狀態失敗: ${error.message}`);
    }
    bot.sendMessage(msg.chat.id, `📊 *系統 Uptime:* \n\`${stdout.trim()}\``, { parse_mode: 'Markdown' });
  });
});

// 遠端 Shell 指令執行 (自用進階控制)
bot.onText(/\/cmd (.+)/, (msg, match) => {
  if (!isAuthorized(msg)) return;

  const command = match[1];
  bot.sendMessage(msg.chat.id, `⏳ 正在執行: \`${command}\`...`, { parse_mode: 'Markdown' });

  exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
    if (error) {
      return bot.sendMessage(msg.chat.id, `❌ *執行失敗:*\n\`\`\`\n${error.message}\n\`\`\``, { parse_mode: 'Markdown' });
    }
    const output = stdout || stderr || '指令執行完畢，無輸出。';
    bot.sendMessage(msg.chat.id, `✅ *執行結果:*\n\`\`\`\n${output.trim()}\n\`\`\``, { parse_mode: 'Markdown' });
  });
});

// 錯誤處理
bot.on('polling_error', (error) => {
  console.error('Telegram Polling 錯誤:', error.message);
});