const fs = require('fs-extra');
const path = require('path');
const cron = require('node-cron');
const { EmbedBuilder, WebhookClient } = require('discord.js');
const { config } = require('../utils/config.js');

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
    } else {
      console.log('⚠️ Webhook de sauvegarde non configuré dans config.json');
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

  async performBackup(isManual = false) {
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
        .setTitle(isManual ? '🔄 Sauvegarde Manuelle' : '📦 Sauvegarde Automatique Quotidienne')
        .setDescription(`Sauvegarde des données essentielles effectuée le ${new Date().toLocaleDateString('fr-FR', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}`)
        .setColor(isManual ? 0x0099FF : 0x00FF00)
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

      // Envoyer les fichiers JSON individuellement avec gestion des limites Discord
      await this.sendBackupFiles(backupData);

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

  async sendBackupFiles(backupData) {
    const MAX_FILES_PER_MESSAGE = 10; // Limite Discord
    const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB limite Discord
    const dateString = new Date().toISOString().split('T')[0];
    
    const filesToSend = [];
    
    // Préparer les fichiers à envoyer
    for (const [filename, info] of Object.entries(backupData)) {
      if (!info.error && info.data) {
        const jsonData = JSON.stringify(info.data, null, 2);
        const buffer = Buffer.from(jsonData, 'utf8');
        
        // Vérifier la taille du fichier
        if (buffer.length > MAX_FILE_SIZE) {
          console.log(`⚠️ Fichier ${filename} trop volumineux (${this.formatSize(buffer.length)}), envoi des métadonnées uniquement`);
          
          // Créer un fichier de métadonnées pour les gros fichiers
          const metaData = {
            filename: filename,
            size: info.size,
            entries: info.entries,
            lastModified: info.lastModified,
            error: `Fichier trop volumineux pour Discord (${this.formatSize(buffer.length)})`
          };
          
          const metaBuffer = Buffer.from(JSON.stringify(metaData, null, 2), 'utf8');
          filesToSend.push({
            attachment: metaBuffer,
            name: `${filename.replace('.json', '')}-metadata-${dateString}.json`
          });
        } else {
          filesToSend.push({
            attachment: buffer,
            name: `${filename.replace('.json', '')}-${dateString}.json`
          });
        }
      }
    }
    
    // Envoyer les fichiers par lots
    if (filesToSend.length > 0) {
      const batches = [];
      for (let i = 0; i < filesToSend.length; i += MAX_FILES_PER_MESSAGE) {
        batches.push(filesToSend.slice(i, i + MAX_FILES_PER_MESSAGE));
      }
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNumber = batches.length > 1 ? ` (${i + 1}/${batches.length})` : '';
        
        try {
          await this.backupWebhook.send({
            content: `📎 **Fichiers de sauvegarde${batchNumber}**\n${batch.map(f => `• ${f.name}`).join('\n')}`,
            files: batch
          });
          
          console.log(`✅ Lot ${i + 1}/${batches.length} envoyé: ${batch.length} fichier(s)`);
          
          // Petite pause entre les messages pour éviter le rate limiting
          if (i < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          console.error(`❌ Erreur lors de l'envoi du lot ${i + 1}:`, error);
          
          // Essayer d'envoyer les fichiers un par un en cas d'erreur
          await this.sendFilesIndividually(batch, i + 1);
        }
      }
    } else {
      await this.backupWebhook.send({
        content: '⚠️ Aucun fichier de sauvegarde valide à envoyer.'
      });
    }
  }

  async sendFilesIndividually(files, batchNumber) {
    console.log(`🔄 Envoi individuel des fichiers du lot ${batchNumber}...`);
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      try {
        await this.backupWebhook.send({
          content: `📎 **Fichier de sauvegarde** (${i + 1}/${files.length} du lot ${batchNumber})`,
          files: [file]
        });
        
        console.log(`✅ Fichier individuel envoyé: ${file.name}`);
        
        // Pause pour éviter le rate limiting
        if (i < files.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`❌ Erreur lors de l'envoi de ${file.name}:`, error);
        
        // Envoyer un message d'erreur pour ce fichier
        try {
          await this.backupWebhook.send({
            content: `❌ **Erreur fichier:** ${file.name}\n\`\`\`${error.message}\`\`\``
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
    
    // Envoyer un message pour indiquer le début de la sauvegarde manuelle
    if (this.backupWebhook) {
      try {
        const startEmbed = new EmbedBuilder()
          .setTitle('🔄 Sauvegarde Manuelle Démarrée')
          .setDescription('Sauvegarde manuelle en cours...')
          .setColor(0xFFAA00)
          .setTimestamp();

        await this.backupWebhook.send({
          embeds: [startEmbed]
        });
      } catch (error) {
        console.error('Erreur lors de l\'envoi du message de début:', error);
      }
    }
    
    await this.performBackup(true);
  }

  // Méthode pour tester la sauvegarde
  async testBackup() {
    if (!this.backupWebhook) {
      console.log('❌ Webhook de sauvegarde non configuré');
      throw new Error('Webhook de sauvegarde non configuré');
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
      throw new Error(`Test de sauvegarde échoué: ${error.message}`);
    }
  }
}

module.exports = BackupManager;
