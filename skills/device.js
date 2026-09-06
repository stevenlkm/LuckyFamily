const fs = require('fs');
const path = require('path');
const googleSkill = require('./google');

const devicesFilePath = path.join(__dirname, '../config/devices.json');

/**
 * 讀取 config/devices.json 設定檔
 */
function loadDevicesConfig() {
  try {
    if (fs.existsSync(devicesFilePath)) {
      const data = fs.readFileSync(devicesFilePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('讀取 config/devices.json 失敗:', err.message);
  }
  return [];
}

/**
 * 處理 Telegram 按鈕點擊觸發裝置語音控制
 */
function handleDeviceCallback(bot, query, actionKey) {
  const chatId = query.message.chat.id;
  const devices = loadDevicesConfig();

  // actionKey 格式: deviceId:actionIdx (例如: living_room_light:0)
  const [deviceId, actionIdxStr] = actionKey.split(':');
  const actionIdx = parseInt(actionIdxStr, 10);

  const device = devices.find(d => d.id === deviceId);
  if (device && device.actions && device.actions[actionIdx]) {
    const action = device.actions[actionIdx];
    bot.answerCallbackQuery(query.id, { text: `正在執行: ${action.label}` });

    // 自動觸發 Google 廣播 "Hey Google, <command>"
    googleSkill.broadcastGoogleCommand(bot, chatId, action.command);
  } else {
    bot.answerCallbackQuery(query.id, { text: '❌ 找不到相應的裝置動作' });
  }
}

module.exports = {
  name: 'Smart Home Devices',
  description: 'Google Home 智能家居按鈕控制',
  handleDeviceCallback,
  commands: [
    {
      cmd: 'device',
      desc: '彈出智能家居裝置按鈕控制選單 (別名: /devices)',
      regex: /^\/(device|devices)$/,
      handler: (bot, msg) => {
        const chatId = msg.chat.id;
        const devices = loadDevicesConfig();

        if (!devices || devices.length === 0) {
          return bot.sendMessage(
            chatId,
            '⚠️ 尚未設定任何裝置！請於 `config/devices.json` 新增裝置與口令。',
            { parse_mode: 'Markdown' }
          );
        }

        const inlineKeyboard = [];

        // 依據裝置設定產生按鈕列
        devices.forEach(device => {
          const row = [];
          if (Array.isArray(device.actions)) {
            device.actions.forEach((act, idx) => {
              row.push({
                text: `${act.label}`,
                callback_data: `dev_${device.id}:${idx}`
              });
            });
          }
          if (row.length > 0) {
            inlineKeyboard.push(row);
          }
        });

        bot.sendMessage(chatId, '🏠 *請選擇要操控嘅智能家居裝置：*', {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: inlineKeyboard
          }
        });
      }
    }
  ]
};