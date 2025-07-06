const axios = require('axios');
const { config } = require('./config.js');
const { logToWebhookAndConsole } = require('./logger.js');

async function checkClartyBlacklist(userId) {
  // Si Clarty n'est pas activé dans la config, on laisse passer
  if (!config.clarty || !config.clarty.enabled || !config.clarty.apiKey) {
    return { isBlacklisted: false, error: null };
  }

  try {
    const response = await axios.get(`${config.clarty.apiUrl}/user/${userId}`, {
      headers: {
        'Authorization': config.clarty.apiKey
      },
      timeout: 5000 // Timeout de 5 secondes
    });

    return {
      isBlacklisted: response.data.isBlacklisted || false,
      userData: response.data,
      error: null
    };
  } catch (error) {
    console.log(`Erreur lors de la vérification Clarty pour l'utilisateur ${userId}:`, error.message);
    
    // Notifier l'erreur par webhook
    await logToWebhookAndConsole(
      "⚠️ Erreur API Clarty OpenBL",
      `Impossible de vérifier le statut de blacklist pour l'utilisateur.`,
      [
        { name: "Utilisateur ID", value: userId, inline: true },
        { name: "Erreur", value: error.message, inline: false },
        { name: "Action", value: "Connexion autorisée par défaut", inline: true }
      ],
      0xFFA500 // Orange pour les avertissements
    );

    return {
      isBlacklisted: false,
      error: error.message
    };
  }
}

module.exports = {
  checkClartyBlacklist
};
