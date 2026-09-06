const { exec } = require("child_process");

module.exports = {
  name: "System",
  description: "系統監控與 Shell 指令",
  commands: [
    {
      cmd: "ping",
      desc: "測試 Bot 連線狀態",
      handler: (bot, msg) => {
        bot.sendMessage(msg.chat.id, "🏓 Pong! Mac Studio 連線正常。");
      },
    },
    {
      cmd: "status",
      desc: "檢查 Mac Studio 運作狀態",
      handler: (bot, msg) => {
        exec("uptime", (error, stdout) => {
          if (error) {
            return bot.sendMessage(
              msg.chat.id,
              `❌ 取得狀態失敗: ${error.message}`,
            );
          }
          bot.sendMessage(
            msg.chat.id,
            `📊 *Mac Studio 運作狀態:* \n\`${stdout.trim()}\``,
            { parse_mode: "Markdown" },
          );
        });
      },
    },
    {
      cmd: "cmd <指令>",
      desc: "執行系統 Shell 指令",
      regex: /\/cmd (.+)/,
      handler: (bot, msg, match) => {
        const command = match[1];
        bot.sendMessage(msg.chat.id, `⏳ 正在執行: \`${command}\`...`, {
          parse_mode: "Markdown",
        });

        exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
          if (error) {
            return bot.sendMessage(
              msg.chat.id,
              `❌ *執行失敗:*\n\`\`\`\n${error.message}\n\`\`\``,
              { parse_mode: "Markdown" },
            );
          }
          const output = stdout || stderr || "指令執行完畢，無輸出。";
          bot.sendMessage(
            msg.chat.id,
            `✅ *執行結果:*\n\`\`\`\n${output.trim()}\n\`\`\``,
            { parse_mode: "Markdown" },
          );
        });
      },
    },
  ],
};
