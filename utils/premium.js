const fs = require('fs-extra');
const path = require('path');

const giftCodesPath = path.join(__dirname, '../gift-codes.json');
const premiumPath = path.join(__dirname, '../premium.json');

// Gestion des codes cadeaux
let giftCodes = {};

function reloadGiftCodes() {
  try {
    if (fs.existsSync(giftCodesPath)) {
      giftCodes = fs.readJsonSync(giftCodesPath);
    } else {
      giftCodes = {};
    }
    return giftCodes;
  } catch (error) {
    console.error('Erreur lors du chargement des codes cadeaux:', error);
    return {};
  }
}

function saveGiftCodes() {
  try {
    fs.writeJsonSync(giftCodesPath, giftCodes, { spaces: 2 });
    return true;
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des codes cadeaux:', error);
    return false;
  }
}

// Fonction pour générer un code cadeau aléatoire
function generateGiftCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) result += '-';
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Gestion des serveurs premium
let premiumGuilds = [];

function loadPremiumList() {
  try {
    if (fs.existsSync(premiumPath)) {
      const data = fs.readJsonSync(premiumPath);
      
      // Support de l'ancien format (array simple)
      if (Array.isArray(data)) {
        premiumGuilds = data.filter(id => id && typeof id === 'string' && /^\d{17,19}$/.test(id));
        console.log(`Liste premium chargée (ancien format): ${premiumGuilds.length} serveurs`);
        // Migrer vers le nouveau format
        savePremiumList();
      } 
      // Nouveau format (objet avec métadonnées)
      else if (data && Array.isArray(data.guilds)) {
        premiumGuilds = data.guilds.filter(id => id && typeof id === 'string' && /^\d{17,19}$/.test(id));
        console.log(`Liste premium chargée: ${premiumGuilds.length} serveurs (dernière MAJ: ${data.lastUpdated})`);
      }
      else {
        throw new Error('Format de fichier premium invalide');
      }
    } else {
      premiumGuilds = [];
      console.log('Fichier premium inexistant, création d\'une nouvelle liste');
      savePremiumList();
    }
    return premiumGuilds;
  } catch (error) {
    console.error('Erreur lors du chargement de la liste premium:', error);
    premiumGuilds = [];
    
    // Tenter de charger depuis backup
    try {
      const backupFiles = fs.readdirSync(path.dirname(premiumPath)).filter(f => f.startsWith('premium_backup_'));
      if (backupFiles.length > 0) {
        const latestBackup = backupFiles.sort().pop();
        const backupSource = path.join(path.dirname(premiumPath), latestBackup);
        const backupData = fs.readJsonSync(backupSource);
        premiumGuilds = Array.isArray(backupData) ? backupData : (backupData.guilds || []);
        console.log(`Liste premium restaurée depuis backup: ${latestBackup}`);
        savePremiumList();
      }
    } catch (backupError) {
      console.error('Impossible de restaurer depuis backup:', backupError);
    }
    
    return premiumGuilds;
  }
}

function savePremiumList() {
  try {
    // Créer un backup avant sauvegarde
    const timestamp = Date.now();
    const backupPath = path.join(__dirname, `../premium_backup_${timestamp}.json`);
    
    // Support du nouveau format avec métadonnées
    const premiumData = {
      guilds: premiumGuilds.filter(id => id && typeof id === 'string' && /^\d{17,19}$/.test(id)),
      lastUpdated: new Date().toISOString(),
      version: "2.0"
    };
    
    // Créer le backup
    if (fs.existsSync(premiumPath)) {
      fs.copySync(premiumPath, backupPath);
    }
    
    // Sauvegarder la nouvelle version
    fs.writeJsonSync(premiumPath, premiumData, { spaces: 2 });
    
    console.log(`Liste premium sauvegardée: ${premiumData.guilds.length} serveurs`);
    
    // Nettoyer les anciens backups (garder seulement les 5 derniers)
    const backupFiles = fs.readdirSync(path.dirname(premiumPath)).filter(f => f.startsWith('premium_backup_'));
    if (backupFiles.length > 5) {
      backupFiles.sort().slice(0, -5).forEach(file => {
        const filePath = path.join(path.dirname(premiumPath), file);
        try {
          fs.removeSync(filePath);
        } catch (e) {
          console.warn(`Impossible de supprimer le backup ${file}:`, e.message);
        }
      });
    }
    
    return true;
  } catch (error) {
    console.error('Erreur lors de la sauvegarde de la liste premium:', error);
    
    // Tenter de restaurer depuis backup en cas d'erreur
    try {
      const backupFiles = fs.readdirSync(path.dirname(premiumPath)).filter(f => f.startsWith('premium_backup_'));
      if (backupFiles.length > 0) {
        const latestBackup = backupFiles.sort().pop();
        const backupSource = path.join(path.dirname(premiumPath), latestBackup);
        fs.copySync(backupSource, premiumPath);
        console.log(`Liste premium restaurée depuis backup: ${latestBackup}`);
      }
    } catch (restoreError) {
      console.error('Impossible de restaurer depuis backup:', restoreError);
    }
    
    return false;
  }
}

// Charger les données au démarrage
reloadGiftCodes();
loadPremiumList();

module.exports = {
  giftCodes,
  get premiumGuilds() { return premiumGuilds; },
  set premiumGuilds(value) { premiumGuilds = value; },
  reloadGiftCodes,
  saveGiftCodes,
  loadPremiumList,
  savePremiumList,
  generateGiftCode,
  
  // Fonction pour synchroniser avec le client
  syncWithClient(client) {
    if (client && Array.isArray(client.premiumGuilds)) {
      // Synchroniser les listes
      const combined = [...new Set([...premiumGuilds, ...client.premiumGuilds])];
      premiumGuilds.length = 0;
      premiumGuilds.push(...combined);
      client.premiumGuilds.length = 0;
      client.premiumGuilds.push(...combined);
    }
  },
  
  // Fonction pour ajouter un serveur premium avec synchronisation
  addPremiumGuild(guildId, client = null) {
    if (!premiumGuilds.includes(guildId)) {
      premiumGuilds.push(guildId);
    }
    if (client && Array.isArray(client.premiumGuilds) && !client.premiumGuilds.includes(guildId)) {
      client.premiumGuilds.push(guildId);
    }
    // Sauvegarder automatiquement après ajout
    return this.savePremiumList();
  },
  
  // Fonction pour supprimer un serveur premium avec synchronisation
  removePremiumGuild(guildId, client = null) {
    const index = premiumGuilds.indexOf(guildId);
    if (index > -1) {
      premiumGuilds.splice(index, 1);
    }
    if (client && Array.isArray(client.premiumGuilds)) {
      const clientIndex = client.premiumGuilds.indexOf(guildId);
      if (clientIndex > -1) {
        client.premiumGuilds.splice(clientIndex, 1);
      }
    }
    // Sauvegarder automatiquement après suppression
    return this.savePremiumList();
  },
  
  // Fonction pour sauvegarder les codes cadeaux avec gestion automatique d'erreur
  saveGiftCodesWithRollback() {
    const backup = { ...giftCodes };
    const success = this.saveGiftCodes();
    if (!success) {
      // Restaurer l'ancien état en cas d'erreur
      Object.keys(giftCodes).forEach(key => delete giftCodes[key]);
      Object.assign(giftCodes, backup);
    }
    return success;
  }
};
