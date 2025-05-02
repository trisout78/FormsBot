const config = require('./config.json');
// Ensure baseUrl includes protocol
const baseUrl = config.webserver.baseUrl.match(/^https?:\/\//) ? config.webserver.baseUrl : `http://${config.webserver.baseUrl}`;
const fs = require('fs-extra');
const { Client, GatewayIntentBits, Collection, Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

// Configuration du client Discord
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST().setToken(config.token);

// Chemins de fichiers et stockage
const formsPath = './forms.json';
let forms = fs.existsSync(formsPath) ? fs.readJsonSync(formsPath) : {};
client.forms = forms;
client.formsPath = formsPath;
client.formBuilders = new Map();
client.webSessions = new Map(); // Pour stocker les sessions web

client.commands = new Collection();
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  if (!command || !command.data || !command.data.name) {
    console.warn(`Skipping invalid command file: ${file}`);
    continue;
  }
  client.commands.set(command.data.name, command);
}

// helper to register commands in a guild
async function registerGuildCommands(guildId) {
  const commandsData = [...client.commands.values()].map(cmd => cmd.data.toJSON());
  await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body: commandsData });
  console.log(`Registered commands for guild ${guildId}`);
}

// helper to build wizard embed and components
function buildWizard(builder) {
  const questionList = builder.questions.map((q, i) => {
    const typeLabel = q.style === 'SHORT' ? 'Court' : q.style === 'PARAGRAPH' ? 'Longue' : '—';
    return `**${i+1}. [${typeLabel}]** ${q.text}`;
  }).join('\n') || 'Aucune question';
  const embed = new EmbedBuilder()
    .setTitle('Assistant de création de formulaire')
    .addFields(
      { name: 'Titre', value: builder.title || 'Non défini', inline: false },
      { name: 'Questions', value: questionList, inline: false },
      { name: 'Salon embed', value: builder.embedChannelId ? `<#${builder.embedChannelId}>` : 'Non défini', inline: false },
      { name: 'Salon réponses', value: builder.responseChannelId ? `<#${builder.responseChannelId}>` : 'Non défini', inline: false },
      { name: 'Texte embed', value: builder.embedText || 'Non défini', inline: false },
      { name: 'Label bouton', value: builder.buttonLabel || 'Non défini', inline: false }
    );
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('add_question').setLabel('➕ Ajouter une question').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('remove_question').setLabel('❌ Retirer une question').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('set_title').setLabel('✏️ Définir titre').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('finish_form').setLabel('✅ Terminer').setStyle(ButtonStyle.Success)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('choose_embed_channel').setLabel('📤 Salon embed').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('choose_response_channel').setLabel('📥 Salon réponses').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('set_embed_text').setLabel('📝 Texte embed').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('set_button_label').setLabel('🔘 Label bouton').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row1, row2] };
}

async function updateWizard(builder) {
  try {
    const { embeds, components } = buildWizard(builder);
    const channel = await client.channels.fetch(builder.wizardChannelId);
    const message = await channel.messages.fetch(builder.messageId);
    await message.edit({ embeds, components });
    console.log(`Wizard mis à jour pour ${builder.userId}, message: ${builder.messageId}`);
    return true;
  } catch (error) {
    console.error('Erreur lors de la mise à jour du wizard:', error.message);
    // Si le message n'est pas trouvé, il a peut-être été supprimé
    if (error.code === 10008) {
      // Dans ce cas, on supprime simplement le builder pour éviter des erreurs répétées
      console.log(`Message wizard introuvable, suppression du builder pour l'utilisateur ${builder.userId}`);
      client.formBuilders.delete(builder.userId);
    }
    return false;
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  // register commands for all current guilds
  client.guilds.cache.forEach(g => registerGuildCommands(g.id));
});

// register commands when bot joins a new guild
client.on('guildCreate', guild => {
  registerGuildCommands(guild.id);
});

client.on(Events.InteractionCreate, async interaction => {
  // Gestionnaire spécifique pour les boutons de suppression de réponse
  if (interaction.isButton() && interaction.customId.startsWith('delete_response_')) {
    console.log('Bouton de suppression détecté:', interaction.customId);
    try {
      // Déférer la réponse immédiatement
      await interaction.deferReply({ ephemeral: true });
      
      const [, , formId, messageId] = interaction.customId.split('_');
      console.log(`Tentative de suppression: formId=${formId}, messageId=${messageId}`);
      
      // Vérifier les permissions
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return await interaction.editReply({ content: 'Vous n\'avez pas la permission pour supprimer les réponses.', ephemeral: true });
      }

      const form = client.forms[interaction.guildId]?.[formId];
      if (!form) {
        console.log('Formulaire non trouvé:', formId);
        return await interaction.editReply({ content: 'Formulaire introuvable.', ephemeral: true });
      }

      try {
        // Récupérer et supprimer le message
        console.log('Récupération du salon de réponses:', form.responseChannelId);
        const responseChannel = await client.channels.fetch(form.responseChannelId);
        console.log('Récupération du message:', messageId);
        const message = await responseChannel.messages.fetch(messageId);
        await message.delete();
        console.log('Message supprimé avec succès');

        // Supprimer l'entrée du répondant
        if (form.respondents) {
          for (const [uid, info] of Object.entries(form.respondents)) {
            if (info.messageId === messageId) {
              delete form.respondents[uid];
              console.log('Entrée répondant supprimée:', uid);
              break;
            }
          }
          // Sauvegarder les changements
          await fs.writeJson(client.formsPath, client.forms, { spaces: 2 });
          console.log('Données sauvegardées');
        }

        await interaction.editReply({ content: 'Réponse supprimée avec succès.', ephemeral: true });
      } catch (error) {
        console.error('Erreur lors de la suppression de la réponse:', error);
        await interaction.editReply({ content: `Erreur lors de la suppression de la réponse: ${error.message}`, ephemeral: true });
      }
    } catch (error) {
      console.error('Erreur générale lors du traitement de la suppression:', error);
      // En cas d'erreur avec deferReply, essayer une méthode alternative
      try {
        if (!interaction.replied) {
          await interaction.reply({ content: 'Une erreur est survenue lors de la suppression.', ephemeral: true });
        }
      } catch (e) {
        console.error('Impossible de répondre à l\'interaction:', e);
      }
    }
    // Arrêter ici pour ne pas exécuter le reste du code
    return;
  }

  // Gestionnaire pour les boutons d'acceptation/refus
  if (interaction.isButton() && (interaction.customId.startsWith('accept_response_') || interaction.customId.startsWith('reject_response_'))) {
    console.log('Bouton de révision détecté:', interaction.customId);
    try {
      // Déférer la réponse immédiatement
      await interaction.deferReply({ ephemeral: true });
      
      const isAccept = interaction.customId.startsWith('accept_response_');
      const [action, , formId, messageId, userId] = interaction.customId.split('_');
      console.log(`Tentative de ${isAccept ? 'acceptation' : 'refus'}: formId=${formId}, messageId=${messageId}, userId=${userId}`);
      
      // Vérifier les permissions
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return await interaction.editReply({ content: 'Vous n\'avez pas la permission pour cette action.', ephemeral: true });
      }

      const form = client.forms[interaction.guildId]?.[formId];
      if (!form || !form.reviewOptions || !form.reviewOptions.enabled) {
        console.log('Formulaire introuvable ou révision désactivée:', formId);
        return await interaction.editReply({ content: 'Formulaire introuvable ou révision désactivée.', ephemeral: true });
      }

      try {
        // Récupérer et mettre à jour le message
        console.log('Récupération du salon de réponses:', form.responseChannelId);
        const responseChannel = await client.channels.fetch(form.responseChannelId);
        console.log('Récupération du message:', messageId);
        const message = await responseChannel.messages.fetch(messageId);
        
        // Créer une nouvelle embed pour remplacer l'existante
        const existingEmbed = message.embeds[0];
        const updatedEmbed = EmbedBuilder.from(existingEmbed)
          .setColor(isAccept ? '#57F287' : '#ED4245')
          .setFooter({ text: isAccept ? '✅ Accepté' : '❌ Refusé' });
        
        // Conserver le bouton de suppression si c'est un formulaire à réponse unique
        let components = [];
        if (form.singleResponse) {
          const deleteButton = new ButtonBuilder()
            .setCustomId(`delete_response_${formId}_${messageId}`)
            .setLabel('Supprimer la réponse')
            .setStyle(ButtonStyle.Danger);
          
          const row = new ActionRowBuilder().addComponents(deleteButton);
          components = [row];
        }
        
        // Mettre à jour le message avec la nouvelle embed et les boutons appropriés
        await message.edit({ embeds: [updatedEmbed], components: components });
        
        // Notifier le membre si spécifié et si l'utilisateur existe
        try {
          if (userId) {
            const target = await client.users.fetch(userId);
            const notificationMessage = isAccept 
              ? (form.reviewOptions.acceptMessage || 'Votre réponse a été acceptée.')
              : (form.reviewOptions.rejectMessage || 'Votre réponse a été refusée.');
            
            await target.send(notificationMessage);
            
            // Ajouter le rôle si spécifié et si l'utilisateur est dans le serveur
            const member = await interaction.guild.members.fetch(userId).catch(() => null);
            if (member) {
              const roleId = isAccept ? form.reviewOptions.acceptRoleId : form.reviewOptions.rejectRoleId;
              if (roleId) {
                await member.roles.add(roleId).catch(err => {
                  console.error(`Erreur lors de l'ajout du rôle ${roleId} à ${userId}:`, err);
                });
              }
            }
            
            // Conserver l'entrée dans les respondents pour empêcher la réponse multiple si singleResponse est activé
            if (form.singleResponse) {
              form.respondents = form.respondents || {};
              if (!form.respondents[userId]) {
                form.respondents[userId] = { responded: true, messageId: messageId };
              }
              await fs.writeJson(client.formsPath, client.forms, { spaces: 2 });
              console.log(`État du répondant ${userId} maintenu pour empêcher les réponses multiples`);
            }
          }
        } catch (err) {
          console.error('Erreur lors de la notification de l\'utilisateur:', err);
        }
        
        await interaction.editReply({ 
          content: `La réponse a été ${isAccept ? 'acceptée' : 'refusée'} avec succès.`, 
          ephemeral: true 
        });
      } catch (error) {
        console.error('Erreur lors du traitement de la réponse:', error);
        await interaction.editReply({ 
          content: `Erreur lors du traitement de la réponse: ${error.message}`, 
          ephemeral: true 
        });
      }
    } catch (error) {
      console.error('Erreur générale lors du traitement de la révision:', error);
      try {
        if (!interaction.replied) {
          await interaction.reply({ content: 'Une erreur est survenue.', ephemeral: true });
        }
      } catch (e) {
        console.error('Impossible de répondre à l\'interaction:', e);
      }
    }
    return;
  }

  // Reste du code pour les autres interactions...
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction, client);
    } catch (error) {
      console.error(error);
      const reply = { content: 'There was an error executing that command.', ephemeral: true };
      interaction.replied || interaction.deferred ? interaction.followUp(reply) : interaction.reply(reply);
    }
  } else if (interaction.isButton()) {
    // handle question style selection
    if (interaction.customId.startsWith('choose_qstyle_')) {
      const builder = client.formBuilders.get(interaction.user.id);
      if (!builder) return;
      const style = interaction.customId.endsWith('_short') ? 'SHORT' : 'PARAGRAPH';
      const idx = builder.questions.length - 1;
      if (idx >= 0) builder.questions[idx].style = style;
      await interaction.deferUpdate();
      await updateWizard(builder);
      return interaction.followUp({ content: 'Type de question défini.', ephemeral: true });
    }
    // fill_ buttons must be handled first
    if (interaction.customId.startsWith('fill_')) {
      const formId = interaction.customId.split('_')[1];
      const form = client.forms[interaction.guildId]?.[formId];
      if (!form) return interaction.reply({ content: 'Formulaire introuvable.', ephemeral: true });

      // Vérifier si l'utilisateur a déjà répondu (si singleResponse est activé)
      if (form.singleResponse && form.respondents && form.respondents[interaction.user.id]) {
        return interaction.reply({ 
          content: 'Vous avez déjà répondu à ce formulaire. Vous ne pouvez pas répondre à nouveau.', 
          ephemeral: true 
        });
      }
      
      // Vérifier le nombre de questions et avertir si > 5
      if (form.questions.length > 5) {
        return interaction.reply({ 
          content: 'Ce formulaire contient trop de questions pour un seul modal (limite Discord: 5). Contactez l\'administrateur du serveur.', 
          ephemeral: true 
        });
      }
      
      const modal = new ModalBuilder()
        .setCustomId(`fill_modal_${formId}`)
        .setTitle('Répondre au formulaire');
      
      form.questions.forEach((q, i) => modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(`answer_${i}`)
            .setLabel(q.text.length > 45 ? q.text.substring(0, 42) + '...' : q.text)
            .setStyle(q.style === 'SHORT' ? TextInputStyle.Short : TextInputStyle.Paragraph)
            .setRequired(true)
        )
      ));
      
      try {
        await interaction.showModal(modal);
      } catch (error) {
        console.error('Erreur lors de l\'affichage du modal:', error);
        await interaction.reply({ 
          content: 'Une erreur est survenue lors de l\'ouverture du formulaire. Veuillez réessayer.', 
          ephemeral: true 
        });
      }
    }
    const builder = client.formBuilders.get(interaction.user.id);
    if (!builder) return;
    
    // Gérer les boutons de wizard qui ouvrent des modals
    if (['add_question', 'set_title', 'set_embed_text', 'set_button_label'].includes(interaction.customId)) {
      // Pour ces boutons, on montre simplement un modal, donc pas besoin de reply/editReply
      if (interaction.customId === 'add_question') {
        const modal = new ModalBuilder()
          .setCustomId('add_question_modal')
          .setTitle('Ajouter une question')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('question_input')
                .setLabel('Votre question')
                .setStyle(TextInputStyle.Paragraph)
            )
          );
        await interaction.showModal(modal);
        return;
      }
      // ...autres modals similaires...
      if (interaction.customId === 'set_title') {
        const modal = new ModalBuilder()
          .setCustomId('set_title_modal')
          .setTitle('Définir le titre du formulaire')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('title_input').setLabel('Titre').setStyle(TextInputStyle.Short)
            )
          );
        await interaction.showModal(modal);
        return;
      }
      if (interaction.customId === 'set_embed_text') {
        const modal = new ModalBuilder()
          .setCustomId('set_embed_text_modal')
          .setTitle('Définir le texte de l\'embed')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('embed_text_input').setLabel('Texte de l\'embed').setStyle(TextInputStyle.Paragraph)
            )
          );
        await interaction.showModal(modal);
        return;
      }
      if (interaction.customId === 'set_button_label') {
        const modal = new ModalBuilder()
          .setCustomId('set_button_label_modal')
          .setTitle('Définir le label du bouton')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('button_label_input').setLabel('Label').setStyle(TextInputStyle.Short)
            )
          );
        await interaction.showModal(modal);
        return;
      }
    }
    
    // Gérer les sélecteurs qui temporairement remplacent l'interface
    else if (interaction.customId === 'remove_question') {
      if (!builder.questions.length) {
        return interaction.reply({ content: 'Aucune question à retirer.', ephemeral: true });
      }
      const menu = new StringSelectMenuBuilder()
        .setCustomId('remove_question_select')
        .setPlaceholder('Sélectionnez une question')
        .addOptions(builder.questions.map((q, idx) => ({ 
          label: q.length > 80 ? q.substring(0, 77) + '...' : q, 
          value: String(idx) 
        })));
      await interaction.reply({ 
        content: 'Sélectionnez une question à supprimer:',
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true 
      });
      return;
    }
    else if (interaction.customId === 'choose_embed_channel') {
      const menu = new ChannelSelectMenuBuilder()
        .setCustomId('choose_embed_channel')
        .setPlaceholder('Choisissez le salon où sera envoyé l\'embed');
      await interaction.reply({ 
        content: 'Sélectionnez un salon:',
        components: [new ActionRowBuilder().addComponents(menu)], 
        ephemeral: true 
      });
      return;
    }
    else if (interaction.customId === 'choose_response_channel') {
      const menu = new ChannelSelectMenuBuilder()
        .setCustomId('choose_response_channel')
        .setPlaceholder('Choisissez le salon où seront envoyées les réponses');
      await interaction.reply({ 
        content: 'Sélectionnez un salon:',
        components: [new ActionRowBuilder().addComponents(menu)], 
        ephemeral: true 
      });
      return;
    }
    else if (interaction.customId === 'finish_form') {
      if (!builder.questions.length || !builder.title || !builder.embedChannelId || !builder.responseChannelId || !builder.embedText || !builder.buttonLabel) {
        return interaction.reply({ content: 'Formulaire incomplet.', ephemeral: true });
      }
      const formId = builder.isModify ? builder.formId : Date.now().toString();
      client.forms[builder.guildId] = client.forms[builder.guildId] || {};
      client.forms[builder.guildId][formId] = {
        title: builder.title,
        questions: builder.questions,
        embedChannelId: builder.embedChannelId,
        responseChannelId: builder.responseChannelId,
        embedText: builder.embedText,
        buttonLabel: builder.buttonLabel,
        embedMessageId: null // will set below
      };
      fs.writeJsonSync(client.formsPath, client.forms, { spaces: 2 });
      const embedChan = await client.channels.fetch(builder.embedChannelId);
      const btn = new ButtonBuilder().setCustomId(`fill_${formId}`).setLabel(builder.buttonLabel).setStyle(ButtonStyle.Primary);
      const formEmbed = new EmbedBuilder().setTitle(builder.title).setDescription(builder.embedText);
      let sentMessage;
      if (builder.isModify) {
        sentMessage = await embedChan.messages.fetch(builder.embedMessageId);
        await sentMessage.edit({ embeds: [formEmbed], components: [new ActionRowBuilder().addComponents(btn)] });
      } else {
        sentMessage = await embedChan.send({ embeds: [formEmbed], components: [new ActionRowBuilder().addComponents(btn)] });
      }
      // store messageId for future modifications
      client.forms[builder.guildId][formId].embedMessageId = sentMessage.id;
      fs.writeJsonSync(client.formsPath, client.forms, { spaces: 2 });
      client.formBuilders.delete(interaction.user.id);
      await interaction.reply({ content: 'Formulaire créé !', ephemeral: true });
    } 
    else if (interaction.customId.startsWith('fill_')) {
      const formId = interaction.customId.split('_')[1];
      const form = client.forms[interaction.guildId]?.[formId];
      if (!form) return interaction.reply({ content: 'Formulaire introuvable.', ephemeral: true });
      
      // Vérifier si l'utilisateur a déjà répondu (si singleResponse est activé)
      if (form.singleResponse && form.respondents && form.respondents[interaction.user.id]) {
        return interaction.reply({ 
          content: 'Vous avez déjà répondu à ce formulaire. Vous ne pouvez pas répondre à nouveau.', 
          ephemeral: true 
        });
      }
      
      // Vérifier le nombre de questions et avertir si > 5
      if (form.questions.length > 5) {
        return interaction.reply({ 
          content: 'Ce formulaire contient trop de questions pour un seul modal (limite Discord: 5). Contactez l\'administrateur du serveur.', 
          ephemeral: true 
        });
      }
      
      const modal = new ModalBuilder()
        .setCustomId(`fill_modal_${formId}`)
        .setTitle('Répondre au formulaire');
      
      form.questions.forEach((q, i) => modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(`answer_${i}`)
            .setLabel(q.text.length > 45 ? q.text.substring(0, 42) + '...' : q.text)
            .setStyle(q.style === 'SHORT' ? TextInputStyle.Short : TextInputStyle.Paragraph)
            .setRequired(true)
        )
      ));
      
      try {
        await interaction.showModal(modal);
      } catch (error) {
        console.error('Erreur lors de l\'affichage du modal:', error);
        await interaction.reply({ 
          content: 'Une erreur est survenue lors de l\'ouverture du formulaire. Veuillez réessayer.', 
          ephemeral: true 
        });
      }
    }
  } else if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('fill_modal_')) {
      // Traitement spécial pour les réponses aux formulaires (pas de formBuilder)
      const formId = interaction.customId.split('_')[2];
      const form = client.forms[interaction.guildId]?.[formId];
      if (!form) return interaction.reply({ content: 'Formulaire introuvable.', ephemeral: true });
      
      // Vérifier si l'utilisateur a déjà répondu (si singleResponse est activé)
      if (form.singleResponse && form.respondents && form.respondents[interaction.user.id]) {
        return interaction.reply({ 
          content: 'Vous avez déjà répondu à ce formulaire. Vous ne pouvez pas répondre à nouveau.', 
          ephemeral: true 
        });
      }
      
      const answers = form.questions.map((_, i) => interaction.fields.getTextInputValue(`answer_${i}`));
      const resultEmbed = new EmbedBuilder()
        .setTitle('Nouvelles réponses')
        .setAuthor({ name: `${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
        .addFields(form.questions.map((q, i) => ({ name: q.text, value: answers[i] })));
      
      const targetChannel = await client.channels.fetch(form.responseChannelId);
      
      // Préparer les boutons selon les options du formulaire
      let components = [];
      let messageId;
      
      // Envoyer d'abord le message pour avoir l'ID
      const sent = await targetChannel.send({ embeds: [resultEmbed] });
      messageId = sent.id;
      
      // Construction des boutons selon les options
      const buttons = [];
      
      // Ajouter le bouton de suppression si c'est un formulaire à réponse unique
      if (form.singleResponse) {
        const deleteButton = new ButtonBuilder()
          .setCustomId(`delete_response_${formId}_${messageId}`)
          .setLabel('Supprimer la réponse')
          .setStyle(ButtonStyle.Danger);
        buttons.push(deleteButton);
      }
      
      // Ajouter les boutons d'acceptation/refus si la révision est activée
      if (form.reviewOptions && form.reviewOptions.enabled) {
        const acceptButton = new ButtonBuilder()
          .setCustomId(`accept_response_${formId}_${messageId}_${interaction.user.id}`)
          .setLabel('Accepter')
          .setStyle(ButtonStyle.Success);
          
        const rejectButton = new ButtonBuilder()
          .setCustomId(`reject_response_${formId}_${messageId}_${interaction.user.id}`)
          .setLabel('Refuser')
          .setStyle(ButtonStyle.Danger);
          
        buttons.push(acceptButton, rejectButton);
      }
      
      // Ajouter les boutons au message s'il y en a
      if (buttons.length > 0) {
        const row = new ActionRowBuilder().addComponents(buttons);
        await sent.edit({ components: [row] });
      }
      
      // Marquer l'utilisateur comme ayant répondu
      if (form.singleResponse) {
        form.respondents = form.respondents || {};
        form.respondents[interaction.user.id] = {
          responded: true,
          messageId: messageId
        };
        fs.writeJsonSync(client.formsPath, client.forms, { spaces: 2 });
      }
      
      await interaction.reply({ content: 'Merci pour vos réponses !', ephemeral: true });
      return;
    }
    
    // Pour les autres modals (partie du wizard)
    const builder = client.formBuilders.get(interaction.user.id);
    if (!builder) return;
    
    // Après un modal on répond d'abord, puis on envoie un message de mise à jour
    if (interaction.customId === 'add_question_modal') {
      const text = interaction.fields.getTextInputValue('question_input');
      builder.questions.push({ text, style: null });
      // ask for style
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('choose_qstyle_short').setLabel('Court').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('choose_qstyle_long').setLabel('Longue').setStyle(ButtonStyle.Primary)
      );
      await interaction.reply({ content: 'Type de réponse pour cette question ?', components: [row], ephemeral: true });
      return;
    }
    else if (interaction.customId === 'set_title_modal') {
      builder.title = interaction.fields.getTextInputValue('title_input');
      await interaction.reply({ content: 'Titre défini', ephemeral: true });
      await updateWizard(builder);
    }
    else if (interaction.customId === 'set_embed_text_modal') {
      builder.embedText = interaction.fields.getTextInputValue('embed_text_input');
      await interaction.reply({ content: 'Texte embed défini', ephemeral: true });
      await updateWizard(builder);
    }
    else if (interaction.customId === 'set_button_label_modal') {
      builder.buttonLabel = interaction.fields.getTextInputValue('button_label_input');
      await interaction.reply({ content: 'Label bouton défini', ephemeral: true });
      await updateWizard(builder);
    }
  } else if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'deleteform_select') {
      const formId = interaction.values[0];
      delete client.forms[interaction.guildId][formId];
      fs.writeJsonSync(client.formsPath, client.forms, { spaces: 2 });
      await interaction.reply({ content: 'Formulaire supprimé.', ephemeral: true });
    } else if (interaction.customId === 'modifyform_select') {
      const formId = interaction.values[0];
      const guildId = interaction.guildId;
      const formUrl = `${baseUrl}/modify/${guildId}/${formId}`;
      
      const embed = new EmbedBuilder()
        .setTitle('Modification de formulaire')
        .setDescription(`Cliquez sur le lien ci-dessous pour modifier votre formulaire. Ce lien est à usage unique et expirera dans 15 minutes.\n\n**[Modifier le formulaire](${formUrl})**`)
        .setColor('#3498db');
      
      await interaction.update({ content: null, embeds: [embed], components: [] });
    } else if (interaction.customId === 'remove_question_select') {
      const builder = client.formBuilders.get(interaction.user.id);
      const idx = parseInt(interaction.values[0]);
      builder.questions.splice(idx, 1);
      await interaction.update({ content: 'Question retirée', components: [] });
      await updateWizard(builder);
    }
  } else if (interaction.isChannelSelectMenu()) {
    if (['choose_embed_channel', 'choose_response_channel'].includes(interaction.customId)) {
      const builder = client.formBuilders.get(interaction.user.id);
      if (!builder) return;
      
      // Mise à jour du builder avec le nouveau salon
      if (interaction.customId === 'choose_embed_channel') {
        builder.embedChannelId = interaction.values[0];
        await interaction.update({ content: `Salon embed défini: <#${interaction.values[0]}>`, components: [] });
        await updateWizard(builder);
      } else {
        builder.responseChannelId = interaction.values[0];
        await interaction.update({ content: `Salon réponses défini: <#${interaction.values[0]}>`, components: [] });
        await updateWizard(builder);
      }
    }
  }
});

// Configuration du serveur web
const app = express();
const server = http.createServer(app);

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Générer un token unique pour une session d'édition
function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Middleware pour vérifier la validité d'un token
function verifyToken(req, res, next) {
  const token = req.params.token || req.query.token;
  const session = client.webSessions.get(token);
  
  if (!session) {
    return res.status(401).send('Session invalide ou expirée');
  }
  
  // Ajouter les données de session à la requête
  req.session = session;
  next();
}

// Route pour créer un nouveau formulaire
app.get('/create/:guildId', (req, res) => {
  const { guildId } = req.params;
  const token = generateSecureToken();
  
  // Créer une nouvelle session
  client.webSessions.set(token, {
    type: 'create',
    guildId,
    createdAt: Date.now(),
    form: {
      title: '',
      questions: [],
      embedChannelId: null,
      responseChannelId: null,
      embedText: '',
      buttonLabel: 'Répondre',
      singleResponse: false,
      reviewOptions: { enabled: false, acceptMessage: '', rejectMessage: '', acceptRoleId: '', rejectRoleId: '' }
    }
  });
  
  // Redirige vers l'éditeur
  res.redirect(`/edit/${token}`);
  
  // Supprimer la session après 15 minutes
  setTimeout(() => {
    client.webSessions.delete(token);
  }, 15 * 60 * 1000);
});

// Route pour modifier un formulaire existant
app.get('/modify/:guildId/:formId', (req, res) => {
  const { guildId, formId } = req.params;
  const form = client.forms[guildId]?.[formId];
  
  if (!form) {
    return res.status(404).send('Formulaire introuvable');
  }
  
  const token = generateSecureToken();
  
  // Créer une nouvelle session pour l'édition avec les données du formulaire
  client.webSessions.set(token, {
    type: 'modify',
    guildId,
    formId,
    createdAt: Date.now(),
    form: {
      title: form.title,
      questions: form.questions,
      embedChannelId: form.embedChannelId,
      responseChannelId: form.responseChannelId,
      embedText: form.embedText,
      buttonLabel: form.buttonLabel,
      embedMessageId: form.embedMessageId,
      singleResponse: form.singleResponse || false,
      reviewOptions: form.reviewOptions || { enabled: false, acceptMessage: '', rejectMessage: '', acceptRoleId: '', rejectRoleId: '' }
    }
  });
  // Rediriger vers l'éditeur
  res.redirect(`/edit/${token}`);
  // Supprimer la session après 15 minutes
  setTimeout(() => client.webSessions.delete(token), 15 * 60 * 1000);
});

// Page de l'éditeur
app.get('/edit/:token', verifyToken, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'editor.html'));
});

// API pour obtenir les données du formulaire
app.get('/api/form/:token', verifyToken, (req, res) => {
  const { guildId } = req.session;
  const guild = client.guilds.cache.get(guildId);
  
  if (!guild) {
    return res.status(404).json({ error: 'Serveur introuvable' });
  }
  
  // Obtenir les canaux du serveur
  const channels = guild.channels.cache
    .filter(c => c.type === 0) // TextChannel
    .map(c => ({ id: c.id, name: c.name }));
  
  // Obtenir les rôles du serveur
  const roles = guild.roles.cache
    .filter(r => r.name !== '@everyone')
    .map(r => ({ id: r.id, name: r.name }));
  
  res.json({
    form: req.session.form,
    channels: channels,
    roles: roles
  });
});

// API pour sauvegarder le formulaire
app.post('/api/form/:token', verifyToken, async (req, res) => {
  const { type, guildId, formId, form: sessionForm } = req.session;
  const updatedForm = req.body.form;
  
  if (!updatedForm) {
    return res.status(400).json({ error: 'Données du formulaire manquantes' });
  }
  
  try {
    // Valider le formulaire
    if (!updatedForm.title || !updatedForm.embedText || !updatedForm.buttonLabel ||
        !updatedForm.embedChannelId || !updatedForm.responseChannelId || 
        !updatedForm.questions || updatedForm.questions.length === 0) {
      return res.status(400).json({ error: 'Formulaire incomplet' });
    }
    
    // Préparation pour sauvegarder dans client.forms
    client.forms[guildId] = client.forms[guildId] || {};
    const finalFormId = type === 'modify' ? formId : Date.now().toString();
    
    // Récupérer l'ID du message existant si c'est une modification
    const existingMessageId = type === 'modify' ? 
      (sessionForm.embedMessageId || (client.forms[guildId][finalFormId]?.embedMessageId)) : null;
    
    // Sauvegarder le formulaire
    client.forms[guildId][finalFormId] = {
      title: updatedForm.title,
      questions: updatedForm.questions,
      embedChannelId: updatedForm.embedChannelId,
      responseChannelId: updatedForm.responseChannelId,
      embedText: updatedForm.embedText,
      buttonLabel: updatedForm.buttonLabel,
      singleResponse: updatedForm.singleResponse || false,
      reviewOptions: updatedForm.reviewOptions || { enabled: false, acceptMessage: '', rejectMessage: '', acceptRoleId: '', rejectRoleId: '' },
      embedMessageId: existingMessageId,
      respondents: type === 'modify' && client.forms[guildId][finalFormId]?.respondents ? 
        client.forms[guildId][finalFormId].respondents : {}
    };
    
    // Créer ou mettre à jour l'embed Discord
    const embedChan = await client.channels.fetch(updatedForm.embedChannelId);
    const btn = new ButtonBuilder()
      .setCustomId(`fill_${finalFormId}`)
      .setLabel(updatedForm.buttonLabel)
      .setStyle(ButtonStyle.Primary);
    
    const formEmbed = new EmbedBuilder()
      .setTitle(updatedForm.title)
      .setDescription(updatedForm.embedText);
    
    let sentMessage;
    
    if (existingMessageId) {
      try {
        // Tenter de récupérer et modifier le message existant
        sentMessage = await embedChan.messages.fetch(existingMessageId);
        await sentMessage.edit({
          embeds: [formEmbed],
          components: [new ActionRowBuilder().addComponents(btn)]
        });
        console.log(`Message de formulaire modifié avec succès: ${existingMessageId}`);
      } catch (error) {
        // Si le message n'existe plus ou n'est pas accessible, en créer un nouveau
        console.error(`Impossible de modifier le message existant ${existingMessageId}, création d'un nouveau:`, error);
        sentMessage = await embedChan.send({
          embeds: [formEmbed],
          components: [new ActionRowBuilder().addComponents(btn)]
        });
      }
    } else {
      // Nouveau formulaire, envoyer un nouveau message
      sentMessage = await embedChan.send({
        embeds: [formEmbed],
        components: [new ActionRowBuilder().addComponents(btn)]
      });
      console.log(`Nouveau message de formulaire créé: ${sentMessage.id}`);
    }
    
    // Mettre à jour l'ID du message
    client.forms[guildId][finalFormId].embedMessageId = sentMessage.id;
    
    // Sauvegarder dans le fichier
    fs.writeJsonSync(client.formsPath, client.forms, { spaces: 2 });
    
    // Supprimer la session
    client.webSessions.delete(req.params.token);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Erreur lors de la sauvegarde du formulaire:', error);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde du formulaire' });
  }
});

// Démarrer le serveur
server.listen(config.webserver.port, () => {
  console.log(`Serveur web démarré sur le port ${config.webserver.port}`);
});

client.login(config.token);
