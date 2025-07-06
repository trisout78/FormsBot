const axios = require('axios');
const { config } = require('./config.js');

// Fonction utilitaire pour envoyer des logs au webhook Discord et dans la console
async function logToWebhookAndConsole(title, description, fields = [], color = 0x3498db) {
  // Format console log
  const time = new Date().toLocaleString();
  const logMsg = `\n[${time}] ${title}\n${description}\n` + (fields.length ? fields.map(f => `- ${f.name}: ${f.value}`).join('\n') : '');
  console.log(logMsg);
  
  // Webhook log
  try {
    if (!config.webhookUrl) return;
    
    const embed = {
      title: title,
      description: description,
      color: color,
      fields: fields,
      timestamp: new Date().toISOString()
    };
    
    await axios.post(config.webhookUrl, {
      embeds: [embed]
    });
  } catch (error) {
    console.error('Erreur lors de l\'envoi du webhook:', error.message);
  }
}

module.exports = {
  logToWebhookAndConsole
};
