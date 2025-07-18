const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BackupManager = require('../utils/backup.js');
const config = require('../utils/config.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Commandes de gestion des sauvegardes (Admin uniquement)')
    .addSubcommand(subcommand =>
      subcommand
        .setName('test')
        .setDescription('Tester la connexion au webhook de sauvegarde')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('manual')
        .setDescription('Déclencher une sauvegarde manuelle')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Afficher le statut du système de sauvegarde')
    ),
  staffOnly: true,  // Marquer cette commande comme staff uniquement

  async execute(interaction) {
    // Double vérification staff
    if (!config.staff.includes(interaction.user.id)) {
      return await interaction.reply({
        content: '❌ Vous n\'avez pas les permissions nécessaires pour utiliser cette commande.',
        ephemeral: true
      });
    }

    const subcommand = interaction.options.getSubcommand();
    const backupManager = new BackupManager();

    await interaction.deferReply({ ephemeral: true });

    switch (subcommand) {
      case 'test':
        const testResult = await backupManager.testBackup();
        await interaction.editReply({
          content: testResult ? 
            '✅ Test de sauvegarde réussi ! Le webhook fonctionne correctement.' : 
            '❌ Test de sauvegarde échoué. Vérifiez la configuration du webhook.'
        });
        break;

      case 'manual':
        try {
          await backupManager.manualBackup();
          await interaction.editReply({
            content: '✅ Sauvegarde manuelle effectuée avec succès ! Vérifiez le canal de sauvegarde.'
          });
        } catch (error) {
          await interaction.editReply({
            content: `❌ Erreur lors de la sauvegarde manuelle : ${error.message}`
          });
        }
        break;

      case 'status':
        const statusEmbed = new EmbedBuilder()
          .setTitle('📦 Statut du Système de Sauvegarde')
          .setColor(0x0099FF)
          .addFields(
            { 
              name: '⚙️ Configuration', 
              value: config.webhookUrlBackup ? '✅ Webhook configuré' : '❌ Webhook non configuré', 
              inline: true 
            },
            { 
              name: '📁 Fichiers surveillés', 
              value: backupManager.backupFiles.join('\n'), 
              inline: true 
            },
            { 
              name: '⏰ Programmation', 
              value: 'Tous les jours à 00:00 (minuit)', 
              inline: true 
            },
            { 
              name: '🌍 Fuseau horaire', 
              value: 'Europe/Paris', 
              inline: true 
            },
            { 
              name: '📋 Commandes disponibles', 
              value: '• `/backup test` - Tester le webhook\n• `/backup manual` - Sauvegarde manuelle\n• `/backup status` - Afficher ce statut', 
              inline: false 
            }
          )
          .setTimestamp();

        await interaction.editReply({
          embeds: [statusEmbed]
        });
        break;
    }
  }
};
