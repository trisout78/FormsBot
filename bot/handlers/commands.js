const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { config } = require('../../utils/config.js');

async function registerGuildCommands(guildId) {
  const rest = new REST({ version: '9' }).setToken(config.token);
  
  try {
    const commands = [];
    // Ici, on peut ajouter les commandes spécifiques si nécessaire
    // Pour l'instant, on utilise les commandes globales
    
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, guildId),
      { body: commands }
    );
    
    console.log(`Commandes enregistrées pour le serveur ${guildId}`);
  } catch (error) {
    console.error(`Erreur lors de l'enregistrement des commandes pour ${guildId}:`, error);
  }
}

module.exports = {
  registerGuildCommands
};
