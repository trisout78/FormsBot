const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { giftCodes, premiumGuilds, saveGiftCodes, savePremiumList } = require('../utils/premium.js');
const { logToWebhookAndConsole } = require('../utils/logger.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('redeem-premium')
    .setDescription('🎁 Utiliser un code cadeau premium')
    .addStringOption(option =>
      option.setName('code')
        .setDescription('Le code cadeau à utiliser')
        .setRequired(true)
    ),
  
  async execute(interaction, client) {
    const code = interaction.options.getString('code').toUpperCase().trim();

    // Vérifier les permissions
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: '❌ Vous devez avoir la permission "Gérer le serveur" pour utiliser un code cadeau premium.',
        ephemeral: true
      });
    }

    // Vérifier si le serveur est déjà premium
    if (premiumGuilds.includes(interaction.guildId)) {
      const embed = new EmbedBuilder()
        .setTitle('✨ Serveur déjà premium')
        .setDescription('Ce serveur dispose déjà du statut premium!')
        .addFields(
          { name: '🎯 Avantages actifs', value: '• Formulaires illimités\n• Cooldowns personnalisés\n• Support prioritaire\n• Fonctionnalités avancées', inline: false }
        )
        .setColor(0xFFD700)
        .setFooter({ text: 'Votre serveur profite déjà de tous les avantages premium' });

      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }

    try {
      await interaction.deferReply({ ephemeral: true });

      // Vérifier si le code existe
      if (!giftCodes[code]) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Code invalide')
          .setDescription('Ce code cadeau n\'existe pas ou est invalide.')
          .addFields(
            { name: '🔍 Vérifications', value: '• Le code est-il correctement écrit?\n• Avez-vous inclus les tirets?\n• Le code a-t-il déjà été utilisé?', inline: false }
          )
          .setColor(0xE74C3C)
          .setFooter({ text: 'Format attendu: XXXX-XXXX-XXXX-XXXX' });

        return await interaction.editReply({
          embeds: [embed]
        });
      }

      const giftCode = giftCodes[code];

      // Vérifier si le code a déjà été utilisé
      if (giftCode.used) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Code déjà utilisé')
          .setDescription('Ce code cadeau a déjà été utilisé.')
          .addFields(
            { name: '📊 Informations', value: `**Utilisé le:** ${new Date(giftCode.usedAt).toLocaleString()}\n**Utilisé par:** <@${giftCode.usedBy}>\n**Serveur:** ${giftCode.guildId}`, inline: false }
          )
          .setColor(0xE74C3C)
          .setFooter({ text: 'Chaque code ne peut être utilisé qu\'une seule fois' });

        return await interaction.editReply({
          embeds: [embed]
        });
      }

      // Activer le premium sur ce serveur
      premiumGuilds.push(interaction.guildId);
      client.premiumGuilds = premiumGuilds;

      // Marquer le code comme utilisé
      giftCode.used = true;
      giftCode.usedBy = interaction.user.id;
      giftCode.usedAt = new Date().toISOString();
      giftCode.guildId = interaction.guildId;

      // Sauvegarder les changements
      const saveCodesSuccess = saveGiftCodes();
      const savePremiumSuccess = savePremiumList();

      if (!saveCodesSuccess || !savePremiumSuccess) {
        return await interaction.editReply({
          content: '❌ Erreur lors de la sauvegarde. Veuillez réessayer.'
        });
      }

      // Log de l'activation
      await logToWebhookAndConsole(
        "✨ Premium activé via code cadeau",
        `**${interaction.user.username}** a activé le premium sur **${interaction.guild.name}** avec un code cadeau`,
        [
          { name: "Code utilisé", value: `\`${code}\``, inline: true },
          { name: "Utilisateur", value: `${interaction.user.username} (ID: ${interaction.user.id})`, inline: true },
          { name: "Serveur", value: `${interaction.guild.name} (ID: ${interaction.guildId})`, inline: false },
          { name: "Code créé par", value: `<@${giftCode.createdBy}>`, inline: true },
          { name: "Date création", value: new Date(giftCode.createdAt).toLocaleString(), inline: true }
        ],
        0xFFD700
      );

      // Créer l'embed de succès
      const successEmbed = new EmbedBuilder()
        .setTitle('✨ Premium activé avec succès!')
        .setDescription(`🎉 Félicitations! Le serveur **${interaction.guild.name}** est maintenant premium!`)
        .addFields(
          { name: '🎁 Code utilisé', value: `\`${code}\``, inline: true },
          { name: '📅 Activé le', value: new Date().toLocaleString(), inline: true },
          { name: '👤 Activé par', value: interaction.user.toString(), inline: true },
          { 
            name: '🎯 Avantages débloqués', 
            value: '• **Formulaires illimités** (fini la limite de 3)\n• **Cooldowns personnalisés** pour vos formulaires\n• **Support prioritaire** de notre équipe\n• **Fonctionnalités avancées** à venir\n• **Badge premium** sur votre serveur', 
            inline: false 
          }
        )
        .setColor(0xFFD700)
        .setFooter({ text: '🎉 Merci de votre confiance! Profitez bien de vos nouveaux avantages.' })
        .setTimestamp();

      await interaction.editReply({
        embeds: [successEmbed]
      });

      // Envoyer un message de remerciement dans le canal courant (si permissions)
      try {
        if (interaction.channel.permissionsFor(interaction.guild.members.me).has(['SendMessages', 'EmbedLinks'])) {
          const publicEmbed = new EmbedBuilder()
            .setTitle('🎉 Serveur Premium activé!')
            .setDescription(`Ce serveur vient d'être mis à niveau vers le statut premium!`)
            .addFields(
              { name: '✨ Nouveaux avantages', value: 'Formulaires illimités • Cooldowns • Support prioritaire', inline: false }
            )
            .setColor(0xFFD700)
            .setThumbnail(interaction.guild.iconURL({ dynamic: true }));

          setTimeout(() => {
            interaction.channel.send({ embeds: [publicEmbed] }).catch(() => {});
          }, 2000);
        }
      } catch (error) {
        // Ignore les erreurs de permissions
      }

      console.log(`Premium activé sur ${interaction.guild.name} (${interaction.guildId}) par ${interaction.user.username} avec le code ${code}`);

    } catch (error) {
      console.error('Erreur lors de l\'utilisation du code cadeau:', error);
      
      if (interaction.deferred) {
        await interaction.editReply({
          content: '❌ Erreur lors de l\'activation du premium. Veuillez réessayer.'
        });
      } else {
        await interaction.reply({
          content: '❌ Erreur lors de l\'activation du premium. Veuillez réessayer.',
          ephemeral: true
        });
      }
    }
  }
};
