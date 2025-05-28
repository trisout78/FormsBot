const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs-extra');
const config = require('../config.json');

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
      // Générer un code cadeau unique
      function generateGiftCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < 16; i++) {
          if (i > 0 && i % 4 === 0) result += '-';
          result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
      }

      // Charger les codes existants
      const giftCodesPath = './gift-codes.json';
      let giftCodes = fs.existsSync(giftCodesPath) ? fs.readJsonSync(giftCodesPath) : {};

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
      fs.writeJsonSync(giftCodesPath, giftCodes, { spaces: 2 });

      // Créer l'embed de réponse
      const embed = new EmbedBuilder()
        .setTitle('🎁 Code cadeau premium généré')
        .setDescription(`Voici votre nouveau code cadeau premium :`)
        .addFields(
          { name: '🔑 Code', value: `\`${newCode}\``, inline: false },
          { name: '📅 Créé le', value: new Date().toLocaleString('fr-FR'), inline: true },
          { name: '👤 Créé par', value: interaction.user.toString(), inline: true },
          { name: '📋 Instructions', value: 'Ce code peut être utilisé sur la page premium pour activer le statut premium gratuitement sur un serveur.', inline: false }
        )
        .setColor(0xFFD700)
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
        ephemeral: true
      });

      // Log la génération du code
      console.log(`Code cadeau généré: ${newCode} par ${interaction.user.tag} (${interaction.user.id})`);

    } catch (error) {
      console.error('Erreur lors de la génération du code cadeau:', error);
      await interaction.reply({
        content: '❌ Une erreur est survenue lors de la génération du code cadeau.',
        ephemeral: true
      });
    }
  }
};