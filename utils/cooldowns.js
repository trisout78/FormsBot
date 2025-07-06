const fs = require('fs-extra');
const path = require('path');

const cooldownPath = path.join(__dirname, '../cooldown.json');

// Fonction pour charger les cooldowns
function loadCooldowns() {
  try {
    if (fs.existsSync(cooldownPath)) {
      return fs.readJsonSync(cooldownPath);
    }
    return {};
  } catch (error) {
    console.error('Erreur lors du chargement des cooldowns:', error);
    return {};
  }
}

// Fonction pour sauvegarder les cooldowns
function saveCooldowns(cooldowns) {
  try {
    fs.writeJsonSync(cooldownPath, cooldowns, { spaces: 2 });
    return true;
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des cooldowns:', error);
    return false;
  }
}

// Fonction pour nettoyer les anciens cooldowns
function cleanupOldCooldowns() {
  const cooldowns = loadCooldowns();
  const now = Date.now();
  let cleaned = false;
  
  for (const [guildId, guildCooldowns] of Object.entries(cooldowns)) {
    for (const [formId, formCooldowns] of Object.entries(guildCooldowns)) {
      for (const [userId, cooldownEnd] of Object.entries(formCooldowns)) {
        if (now > cooldownEnd) {
          delete cooldowns[guildId][formId][userId];
          cleaned = true;
        }
      }
      
      // Supprimer les formulaires vides
      if (Object.keys(cooldowns[guildId][formId]).length === 0) {
        delete cooldowns[guildId][formId];
      }
    }
    
    // Supprimer les serveurs vides
    if (Object.keys(cooldowns[guildId]).length === 0) {
      delete cooldowns[guildId];
    }
  }
  
  if (cleaned) {
    saveCooldowns(cooldowns);
    console.log('Cooldowns nettoyés');
  }
}

// Fonction utilitaire pour formater la durée du cooldown
function formatCooldownDuration(totalMinutes) {
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  
  const parts = [];
  if (days > 0) parts.push(`${days} jour${days > 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} heure${hours > 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
  
  if (parts.length === 0) return '1 minute';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts.join(' et ');
  return parts.slice(0, -1).join(', ') + ' et ' + parts[parts.length - 1];
}

module.exports = {
  loadCooldowns,
  saveCooldowns,
  cleanupOldCooldowns,
  formatCooldownDuration
};
