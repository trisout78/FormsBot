const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { config } = require('../utils/config.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('createform')
    .setDescription('Créer un formulaire via l\'interface web')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction, client) {
    const guildId = interaction.guildId;

    // Vérifier les permissions
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ 
        content: 'Vous n\'avez pas la permission de créer des formulaires.', 
        ephemeral: true 
      });
    }

    // Vérifier la limite de formulaires pour ce serveur
    const formsForGuild = client.forms[guildId] || {};
    const formCount = Object.keys(formsForGuild).length;
    const isPremium = client.premiumGuilds && client.premiumGuilds.includes(guildId);
    
    if (!isPremium && formCount >= 3) {
      const baseUrl = config.webserver.baseUrl.match(/^https?:\/\//) ? config.webserver.baseUrl : `http://${config.webserver.baseUrl}`;
      const premiumUrl = `${baseUrl}/premium?guild=${guildId}`;
      
      const limitEmbed = new EmbedBuilder()
        .setTitle('❌ Limite atteinte')
        .setDescription('Vous avez atteint la limite de **3 formulaires** pour les serveurs gratuits.')
        .addFields(
          { name: '📊 Formulaires actuels', value: `${formCount}/3`, inline: true },
          { name: '💎 Premium', value: 'Formulaires illimités', inline: true },
          { name: '🔗 Upgrade', value: `[Passer Premium](${premiumUrl})`, inline: true }
        )
        .setColor(0xE74C3C)
        .setFooter({ text: 'Premium: formulaires illimités + fonctionnalités avancées' });
      
      return interaction.reply({ 
        embeds: [limitEmbed], 
        ephemeral: true 
      });
    }

    // Rediriger directement vers l'interface web
    const baseUrl = config.webserver.baseUrl.match(/^https?:\/\//) ? config.webserver.baseUrl : `http://${config.webserver.baseUrl}`;
    const formUrl = `${baseUrl}/create/${guildId}`;

    const webEmbed = new EmbedBuilder()
      .setTitle('🌐 Création de formulaire')
      .setDescription('Créez votre formulaire via notre interface web intuitive et complète.')
      .addFields(
        { 
          name: '✨ Fonctionnalités', 
          value: '• Interface riche et intuitive\n• Prévisualisation en temps réel\n• Options avancées\n• Sauvegarde automatique\n• Gestion complète des paramètres', 
          inline: false 
        },
        { 
          name: '🔗 Accès', 
          value: `[Créer un formulaire](${formUrl})`, 
          inline: false 
        }
      )
      .setColor(0x3498db)
      .setFooter({ text: 'Vous serez redirigé vers Discord pour l\'authentification si nécessaire' });

    const linkButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('🌐 Ouvrir l\'interface web')
        .setStyle(ButtonStyle.Link)
        .setURL(formUrl)
    );

    await interaction.reply({
      embeds: [webEmbed],
      components: [linkButton],
      ephemeral: true
    });
  }
};