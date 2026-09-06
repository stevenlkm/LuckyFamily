module.exports = {
  name: 'Global Cancel',
  description: '系統全局中斷操作',
  commands: [
    {
      cmd: 'cancel',
      desc: '中斷當前所有進行中嘅操作 (別名: /stop)',
      regex: /^\/(cancel|stop)$/,
      handler: (bot, msg) => {
        const chatId = msg.chat.id;
        const cancelled = bot.cancelActiveTasks(chatId);

        if (cancelled) {
          bot.sendMessage(chatId, '🛑 已成功中斷所有正在進行嘅操作 (包括錄音及選單監聽)。');
        } else {
          bot.sendMessage(chatId, 'ℹ️ 當前沒有任何正在執行的操作。');
        }
      }
    }
  ]
};