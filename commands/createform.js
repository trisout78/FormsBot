const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { config } = require('../utils/config.js');
const { buildWizard } = require('../bot/handlers/formBuilder.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('createform')
    .setDescription('Démarrer la création de formulaire')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction, client) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

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

    // Vérifier si l'utilisateur a déjà une session de création active
    if (client.formBuilders.has(userId)) {
      return interaction.reply({
        content: '⚠️ Vous avez déjà une session de création de formulaire active. Terminez-la avant d\'en créer une nouvelle.',
        ephemeral: true
      });
    }

    // Créer le builder initial
    const builder = {
      userId: userId,
      wizardChannelId: interaction.channelId,
      title: '',
      questions: [],
      embedChannelId: '',
      responseChannelId: '',
      embedText: '',
      buttonLabel: ''
    };

    // Créer l'embed et les boutons du wizard
    const { embeds, components } = buildWizard(builder);

    // Ajouter les boutons d'options pour choisir le mode
    const optionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('use_wizard')
        .setLabel('🧙‍♂️ Assistant guidé (Maintenance)')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('use_web_panel')
        .setLabel('🌐 Interface web')
        .setStyle(ButtonStyle.Secondary)
    );

    const introEmbed = new EmbedBuilder()
      .setTitle('🎯 Création de formulaire')
      .setDescription('Choisissez votre méthode de création préférée:')
      .addFields(
        { 
          name: '🧙‍♂️ Assistant guidé', 
          value: 'Interface Discord interactive\n• Simple et rapide\n• Pas besoin de navigateur\n• Assistance étape par étape', 
          inline: true 
        },
        { 
          name: '🌐 Interface web', 
          value: 'Panel web complet\n• Plus d\'options avancées\n• Prévisualisation en temps réel\n• Interface plus riche', 
          inline: true 
        }
      )
      .setColor(0x3498db)
      .setFooter({ text: 'Choisissez la méthode qui vous convient le mieux' });

    await interaction.reply({
      embeds: [introEmbed],
      components: [optionRow],
      ephemeral: true
    });

    // Créer un collecteur pour le choix de mode
    const filter = i => 
      (i.customId === 'use_wizard' || i.customId === 'use_web_panel') && 
      i.user.id === interaction.user.id;
    
    const collector = interaction.channel.createMessageComponentCollector({ 
      filter, 
      time: 60000, 
      max: 1 
    });

    collector.on('collect', async i => {
      if (i.customId === 'use_wizard') {
        // Démarrer l'assistant guidé
        const response = await interaction.channel.send({
          content: `🧙‍♂️ **Assistant de création de formulaire** - ${interaction.user.toString()}`,
          embeds,
          components
        });

        builder.messageId = response.id;
        client.formBuilders.set(userId, builder);

        await i.update({
          content: '✅ Assistant guidé démarré! Utilisez les boutons ci-dessous pour créer votre formulaire.',
          embeds: [],
          components: []
        });

        // Supprimer l'assistant après 15 minutes d'inactivité
        setTimeout(() => {
          if (client.formBuilders.has(userId)) {
            client.formBuilders.delete(userId);
            response.edit({
              content: '⏰ Session expirée. Utilisez `/createform` pour recommencer.',
              components: []
            }).catch(() => {});
          }
        }, 15 * 60 * 1000);

      } else if (i.customId === 'use_web_panel') {
        // Rediriger vers l'interface web
        const baseUrl = config.webserver.baseUrl.match(/^https?:\/\//) ? config.webserver.baseUrl : `http://${config.webserver.baseUrl}`;
        const formUrl = `${baseUrl}/create/${guildId}`;

        const webEmbed = new EmbedBuilder()
          .setTitle('🌐 Interface web - Création de formulaire')
          .setDescription(`Cliquez sur le lien ci-dessous pour créer votre formulaire via l'interface web.`)
          .addFields(
            { name: '🎯 Avantages', value: '• Interface riche et intuitive\n• Prévisualisation en temps réel\n• Options avancées\n• Sauvegarde automatique', inline: false },
            { name: '🔗 Lien', value: `[Créer un formulaire](${formUrl})`, inline: false }
          )
          .setColor(0x3498db)
          .setFooter({ text: 'Vous serez redirigé vers Discord pour l\'authentification si nécessaire' });

        const linkButton = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('🌐 Ouvrir l\'interface web')
            .setStyle(ButtonStyle.Link)
            .setURL(formUrl)
        );

        await i.update({
          embeds: [webEmbed],
          components: [linkButton]
        });
      }
    });

    collector.on('end', collected => {
      if (collected.size === 0) {
        interaction.editReply({
          content: '⏰ Temps écoulé. Utilisez à nouveau `/createform` pour créer un formulaire.',
          embeds: [],
          components: []
        }).catch(() => {});
      }
    });
  }
};