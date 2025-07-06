const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { config } = require('../utils/config.js');
const { giftCodes, saveGiftCodes, generateGiftCode } = require('../utils/premium.js');
const { logToWebhookAndConsole } = require('../utils/logger.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gen-premium')
    .setDescription('🎁 Génère un code cadeau premium (Staff uniquement)'),
  
  async execute(interaction) {
    // Vérifier si l'utilisateur est dans la liste du staff
    if (!config.staff.includes(interaction.user.id)) {
      return interaction.reply({
        content: '❌ Vous n\'avez pas les permissions nécessaires pour utiliser cette commande.',
        ephemeral: true
      });
    }

    try {
      await interaction.deferReply({ ephemeral: true });

      // Générer un code unique
      let newCode;
      do {
        newCode = generateGiftCode();
      } while (giftCodes[newCode]);

      // Créer l'entrée du code cadeau
      giftCodes[newCode] = {
        guildId: null,
        createdBy: interaction.user.id,
        createdAt: new Date().toISOString(),
        used: false,
        usedBy: null,
        usedAt: null
      };

      // Sauvegarder les codes
      const saveSuccess = saveGiftCodes();
      
      if (!saveSuccess) {
        return await interaction.editReply({
          content: '❌ Erreur lors de la sauvegarde du code cadeau.'
        });
      }

      // Log de génération
      await logToWebhookAndConsole(
        "🎁 Code cadeau généré",
        `**${interaction.user.username}** a généré un nouveau code cadeau premium`,
        [
          { name: "Code", value: `\`${newCode}\``, inline: true },
          { name: "Générateur", value: `${interaction.user.username} (ID: ${interaction.user.id})`, inline: true },
          { name: "Date", value: new Date().toLocaleString(), inline: true },
          { name: "Statut", value: "Non utilisé", inline: true }
        ],
        0x9B59B6
      );

      // Créer l'embed de réponse
      const embed = new EmbedBuilder()
        .setTitle('🎁 Code cadeau généré avec succès!')
        .setDescription(`Un nouveau code cadeau premium a été créé.`)
        .addFields(
          { name: '🎫 Code', value: `\`${newCode}\``, inline: false },
          { name: '📋 Instructions', value: 'Ce code peut être utilisé avec la commande `/redeem-premium` pour activer le premium sur un serveur.', inline: false },
          { name: '⚠️ Important', value: '• Gardez ce code secret\n• Utilisable une seule fois\n• Valide indéfiniment\n• Active le premium à vie', inline: false }
        )
        .setColor(0x9B59B6)
        .setFooter({ text: `Généré par ${interaction.user.username} • ${new Date().toLocaleString()}` })
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed]
      });

      console.log(`Code cadeau ${newCode} généré par ${interaction.user.username} (${interaction.user.id})`);

    } catch (error) {
      console.error('Erreur lors de la génération du code cadeau:', error);
      
      if (interaction.deferred) {
        await interaction.editReply({
          content: '❌ Erreur lors de la génération du code cadeau.'
        });
      } else {
        await interaction.reply({
          content: '❌ Erreur lors de la génération du code cadeau.',
          ephemeral: true
        });
      }
    }
  }
};