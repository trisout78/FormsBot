const fs = require('fs-extra');
const path = require('path');

const blacklistPath = path.join(__dirname, '../blacklist.json');

// Stockage en mémoire pour les blacklists
let serverBlacklists = {};

// Fonction pour charger la blacklist
function loadBlacklist() {
  try {
    if (fs.existsSync(blacklistPath)) {
      serverBlacklists = fs.readJsonSync(blacklistPath);
      console.log(`Blacklist chargée: ${Object.keys(serverBlacklists).length} serveurs avec blacklist`);
    } else {
      serverBlacklists = {};
    }
    return serverBlacklists;
  } catch (error) {
    console.error('Erreur lors du chargement de la blacklist:', error);
    serverBlacklists = {};
    return serverBlacklists;
  }
}

// Fonction pour sauvegarder la blacklist
function saveBlacklist(blacklistData) {
  try {
    fs.writeJsonSync(blacklistPath, blacklistData || serverBlacklists, { spaces: 2 });
    console.log('Blacklist sauvegardée avec succès');
    return true;
  } catch (error) {
    console.error('Erreur lors de la sauvegarde de la blacklist:', error);
    return false;
  }
}

// Fonction pour vérifier si un utilisateur est blacklisté sur un serveur
function isUserBlacklisted(guildId, userId) {
  return serverBlacklists[guildId] && serverBlacklists[guildId].includes(userId);
}

// Charger la blacklist au démarrage
loadBlacklist();

module.exports = {
  loadBlacklist,
  saveBlacklist,
  isUserBlacklisted,
  serverBlacklists
};
