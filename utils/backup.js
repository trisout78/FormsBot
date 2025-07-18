const fs = require('fs-extra');
const path = require('path');
const cron = require('node-cron');
const { EmbedBuilder, WebhookClient } = require('discord.js');
const config = require('../utils/config.js');

class BackupManager {
  constructor() {
    this.backupWebhook = null;
    this.backupFiles = [
      'blacklist.json',
      'forms.json', 
      'gift-codes.json',
      'premium.json',
      'vote.json',
      'cooldown.json',
      'vote-timestamps.json'
    ];
    this.init();
  }

  init() {
    // Initialiser le webhook de sauvegarde si configuré
    if (config.webhookUrlBackup) {
      try {
        this.backupWebhook = new WebhookClient({ url: config.webhookUrlBackup });
        console.log('📦 Webhook de sauvegarde initialisé');
      } catch (error) {
        console.error('Erreur lors de l\'initialisation du webhook de sauvegarde:', error);
      }
    }

    // Programmer la sauvegarde quotidienne à minuit (0h00)
    this.scheduleBackup();
  }

  scheduleBackup() {
    // Cron job pour tous les jours à minuit (0 0 * * *)
    cron.schedule('0 0 * * *', () => {
      console.log('🕛 Début de la sauvegarde automatique quotidienne...');
      this.performBackup();
    }, {
      scheduled: true,
      timezone: "Europe/Paris" // Ajustez selon votre fuseau horaire
    });

    console.log('⏰ Sauvegarde automatique programmée pour tous les jours à minuit');
  }

  async performBackup() {
    if (!this.backupWebhook) {
      console.log('❌ Webhook de sauvegarde non configuré, sauvegarde annulée');
      return;
    }

    try {
      const backupData = {};
      const backupStats = {
        successful: 0,
        failed: 0,
        totalSize: 0
      };

      // Lire chaque fichier de sauvegarde
      for (const filename of this.backupFiles) {
        const filePath = path.join(__dirname, '..', filename);
        
        try {
          if (await fs.pathExists(filePath)) {
            const data = await fs.readJson(filePath);
            const stats = await fs.stat(filePath);
            
            backupData[filename] = {
              data: data,
              size: stats.size,
              lastModified: stats.mtime,
              entries: this.countEntries(data)
            };
            
            backupStats.successful++;
            backupStats.totalSize += stats.size;
          } else {
            console.log(`⚠️ Fichier non trouvé: ${filename}`);
            backupData[filename] = {
              error: 'Fichier non trouvé',
              exists: false
            };
          }
        } catch (error) {
          console.error(`❌ Erreur lors de la lecture de ${filename}:`, error);
          backupData[filename] = {
            error: error.message,
            exists: true
          };
          backupStats.failed++;
        }
      }

      // Créer l'embed de sauvegarde
      const embed = new EmbedBuilder()
        .setTitle('📦 Sauvegarde Automatique Quotidienne')
        .setDescription(`Sauvegarde des données essentielles effectuée le ${new Date().toLocaleDateString('fr-FR', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}`)
        .setColor(0x00FF00)
        .setTimestamp()
        .addFields(
          { 
            name: '📊 Statistiques', 
            value: `✅ Fichiers sauvegardés: ${backupStats.successful}\n❌ Échecs: ${backupStats.failed}\n💾 Taille totale: ${this.formatSize(backupStats.totalSize)}`, 
            inline: false 
          }
        );

      // Ajouter les détails pour chaque fichier
      for (const [filename, info] of Object.entries(backupData)) {
        if (info.error) {
          embed.addFields({
            name: `❌ ${filename}`,
            value: `Erreur: ${info.error}`,
            inline: true
          });
        } else {
          embed.addFields({
            name: `✅ ${filename}`,
            value: `📦 ${info.entries} entrées\n💾 ${this.formatSize(info.size)}\n🕒 ${new Date(info.lastModified).toLocaleDateString('fr-FR')}`,
            inline: true
          });
        }
      }

      // Envoyer l'embed
      await this.backupWebhook.send({
        embeds: [embed]
      });

      // Envoyer les données sous forme de fichier JSON (si pas trop volumineux)
      const jsonData = JSON.stringify(backupData, null, 2);
      if (jsonData.length < 2000000) { // Limite Discord ~2MB
        const buffer = Buffer.from(jsonData, 'utf8');
        
        await this.backupWebhook.send({
          content: '📎 Fichier de sauvegarde complet:',
          files: [{
            attachment: buffer,
            name: `backup-${new Date().toISOString().split('T')[0]}.json`
          }]
        });
      } else {
        console.log('⚠️ Fichier de sauvegarde trop volumineux pour être envoyé sur Discord');
      }

      console.log('✅ Sauvegarde automatique terminée avec succès');

    } catch (error) {
      console.error('❌ Erreur lors de la sauvegarde automatique:', error);
      
      // Envoyer un message d'erreur
      if (this.backupWebhook) {
        try {
          const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Erreur de Sauvegarde')
            .setDescription(`Une erreur est survenue lors de la sauvegarde automatique:\n\`\`\`${error.message}\`\`\``)
            .setColor(0xFF0000)
            .setTimestamp();

          await this.backupWebhook.send({
            embeds: [errorEmbed]
          });
        } catch (webhookError) {
          console.error('Erreur lors de l\'envoi du message d\'erreur:', webhookError);
        }
      }
    }
  }

  countEntries(data) {
    if (Array.isArray(data)) {
      return data.length;
    } else if (typeof data === 'object' && data !== null) {
      return Object.keys(data).length;
    }
    return 0;
  }

  formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Méthode pour effectuer une sauvegarde manuelle
  async manualBackup() {
    console.log('🔄 Début de la sauvegarde manuelle...');
    await this.performBackup();
  }

  // Méthode pour tester la sauvegarde
  async testBackup() {
    if (!this.backupWebhook) {
      console.log('❌ Webhook de sauvegarde non configuré');
      return false;
    }

    try {
      const testEmbed = new EmbedBuilder()
        .setTitle('🧪 Test de Sauvegarde')
        .setDescription('Test de connexion au webhook de sauvegarde')
        .setColor(0x0099FF)
        .setTimestamp();

      await this.backupWebhook.send({
        embeds: [testEmbed]
      });

      console.log('✅ Test de sauvegarde réussi');
      return true;
    } catch (error) {
      console.error('❌ Test de sauvegarde échoué:', error);
      return false;
    }
  }
}

module.exports = BackupManager;
