const { initializeBot } = require('./bot/bot.js');
const { initializeWebServer } = require('./web/server.js');
const { cleanupOldCooldowns } = require('./utils/cooldowns.js');
const BackupManager = require('./utils/backup.js');

async function startApplication() {
  console.log('🚀 Démarrage de FormsBot...');
  
  try {
    // Initialiser le bot Discord
    const client = await initializeBot();
    
    // Initialiser le serveur web
    await initializeWebServer(client);
    
    // Initialiser le système de sauvegarde
    const backupManager = new BackupManager();
    
    // Nettoyage initial des cooldowns
    cleanupOldCooldowns();
    
    // Nettoyer les cooldowns tous les jours
    setInterval(cleanupOldCooldowns, 24 * 60 * 60 * 1000);
    
    console.log('✅ FormsBot démarré avec succès !');
  } catch (error) {
    console.error('❌ Erreur lors du démarrage:', error);
    process.exit(1);
  }
}

// Gestion des erreurs non capturées
process.on('unhandledRejection', (reason, promise) => {
  console.log('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.log('Uncaught Exception:', error);
});

// Démarrer l'application
startApplication();
