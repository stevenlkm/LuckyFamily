const pkg = require('../package.json');

module.exports = {
  name: 'System Version',
  description: '系統版本查詢',
  commands: [
    {
      cmd: 'version',
      desc: '查詢目前家居遙控系統版本資訊 (別名: /ver)',
      regex: /\/(version|ver)$/,
      handler: (bot, msg) => {
        const versionMsg = `
📦 *家居遙控系統版本資訊*

🔹 *系統名稱:* \`${pkg.name}\`
🔹 *系統版本:* \`v${pkg.version}\`
🔹 *系統描述:* ${pkg.description}
🔹 *開發團隊:* ${pkg.author.name}
        `;

        bot.sendMessage(msg.chat.id, versionMsg.trim(), { parse_mode: 'Markdown' });
      }
    }
  ]
};