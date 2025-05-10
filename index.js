const config = require('./config.json');
const baseUrl = config.webserver.baseUrl.match(/^https?:\/\//) ? config.webserver.baseUrl : `http://${config.webserver.baseUrl}`;
const fs = require('fs-extra');
const { Client, GatewayIntentBits, Collection, Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const express = require('express');
const http = require('http');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const axios = require('axios');
const url = require('url');

// Fonction utilitaire pour envoyer des logs au webhook Discord et dans la console
async function logToWebhookAndConsole(title, description, fields = [], color = 0x3498db) {
  // Format console log
  const time = new Date().toLocaleString();
  const logMsg = `\n[${time}] ${title}\n${description}\n` + (fields.length ? fields.map(f => `- ${f.name}: ${f.value}`).join('\n') : '');
  console.log(logMsg);
  // Webhook log
  try {
    if (!config.webhookUrl) return;
    const embed = {
      title: title,
      description: description,
      color: color,
      fields: fields,
      timestamp: new Date().toISOString()
    };
    await axios.post(config.webhookUrl, { embeds: [embed] });
  } catch (error) {
    // Log l'erreur dans la console proprement
    const errMsg = `[${new Date().toLocaleString()}] Erreur lors de l'envoi du log au webhook: ${error.message}`;
    console.log(errMsg);
  }
}

// Configuration du client Discord
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST().setToken(config.token);

// Chemins de fichiers et stockage
const formsPath = './forms.json';
let forms = fs.existsSync(formsPath) ? fs.readJsonSync(formsPath) : {};
client.forms = forms;
client.formsPath = formsPath;
client.formBuilders = new Map();
// Stockage temporaire pour les réponses partielles aux formulaires multi-étapes
client.tempResponses = new Map();

client.commands = new Collection();
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  if (!command || !command.data || !command.data.name) {
    console.log(`Skipping invalid command file: ${file}`);
    continue;
  }
  client.commands.set(command.data.name, command);
}

// helper to register commands in a guild
async function registerGuildCommands(guildId) {
  const commandsData = [...client.commands.values()].map(cmd => cmd.data.toJSON());
  await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body: commandsData });
  console.log(`Commande enregistrée pour le serveur ${guildId}`);
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
    console.log('Erreur lors de la mise à jour du wizard:', error.message);
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
  console.log(`Connecté en tant que ${client.user.tag}`);
  client.guilds.cache.forEach(g => registerGuildCommands(g.id));
  
  // Log le démarrage du bot
  await logToWebhookAndConsole(
    "🟢 Bot démarré", 
    `Le bot **${client.user.tag}** est maintenant en ligne.`,
    [
      { name: "Date", value: new Date().toLocaleString(), inline: true },
      { name: "Serveurs", value: client.guilds.cache.size.toString(), inline: true }
    ],
    0x57F287 // Couleur verte
  );
});

// Log quand le bot s'arrête
process.on('SIGINT', async () => {
  console.log('Bot arrêté avec SIGINT');
  await logToWebhookAndConsole(
    "🔴 Bot arrêté", 
    "Le bot a été arrêté manuellement.",
    [{ name: "Date", value: new Date().toLocaleString(), inline: true }],
    0xED4245 // Couleur rouge
  );
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Bot arrêté avec SIGTERM');
  await logToWebhookAndConsole(
    "🔴 Bot arrêté", 
    "Le bot a été arrêté par le système.",
    [{ name: "Date", value: new Date().toLocaleString(), inline: true }],
    0xED4245 // Couleur rouge
  );
  process.exit(0);
});

// register commands when bot joins a new guild
client.on('guildCreate', guild => {
  registerGuildCommands(guild.id);
});

client.on(Events.InteractionCreate, async interaction => {
  // Gestionnaire spécifique pour les boutons de formulaires et étapes suivantes
  if (interaction.isButton() && (interaction.customId.startsWith('fill_') || interaction.customId.startsWith('next_step_'))) {
    let formId, currentStep = 0;

    if (interaction.customId.startsWith('fill_')) {
      formId = interaction.customId.split('_')[1];
    } else if (interaction.customId.startsWith('next_step_')) {
      [, , formId, currentStep] = interaction.customId.split('_');
      currentStep = parseInt(currentStep);
    }

    const form = client.forms[interaction.guildId]?.[formId];
    if (!form) return interaction.reply({ content: 'Formulaire introuvable.', ephemeral: true });

    // Vérifier si l'utilisateur a déjà répondu (si singleResponse est activé)
    if (form.singleResponse && form.respondents && form.respondents[interaction.user.id]) {
      return interaction.reply({ 
        content: 'Vous avez déjà répondu à ce formulaire. Vous ne pouvez pas répondre à nouveau.', 
        ephemeral: true 
      });
    }

    // Si le formulaire contient plus de 5 questions, on utilise la pagination
    const totalQuestions = form.questions.length;
    const questionsPerStep = 5; // Discord limite à 5 questions par modal
    const totalSteps = Math.ceil(totalQuestions / questionsPerStep);
    const startIdx = currentStep * questionsPerStep;
    const endIdx = Math.min(startIdx + questionsPerStep, totalQuestions);
    
    // Créer un modal pour les questions de l'étape actuelle
    const modal = new ModalBuilder()
      .setCustomId(`form_step_${formId}_${currentStep}`)
      .setTitle(`${form.title} (${currentStep + 1}/${totalSteps})`);
    
    // Ajouter les questions pour cette étape
    for (let i = startIdx; i < endIdx; i++) {
      const q = form.questions[i];
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(`answer_${i}`)
            .setLabel(q.text.length > 45 ? q.text.substring(0, 42) + '...' : q.text)
            .setStyle(q.style === 'SHORT' ? TextInputStyle.Short : TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(q.style === 'PARAGRAPH' ? 1024 : 256) // Limite de 1024 caractères pour réponses longues
        )
      );
    }
    
    try {
      await interaction.showModal(modal);
    } catch (error) {
      console.log('Erreur lors de l\'affichage du modal:', error);
      await interaction.reply({ 
        content: 'Une erreur est survenue lors de l\'ouverture du formulaire. Veuillez réessayer.', 
        ephemeral: true 
      });
    }
    return;
  }

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
        console.log('Erreur lors de la suppression de la réponse:', error);
        await interaction.editReply({ content: `Erreur lors de la suppression de la réponse: ${error.message}`, ephemeral: true });
      }
    } catch (error) {
      console.log('Erreur générale lors du traitement de la suppression:', error);
      // En cas d'erreur avec deferReply, essayer une méthode alternative
      try {
        if (!interaction.replied) {
          await interaction.reply({ content: 'Une erreur est survenue lors de la suppression.', ephemeral: true });
        }
      } catch (e) {
        console.log('Impossible de répondre à l\'interaction:', e);
      }
    }
    // Arrêter ici pour ne pas exécuter le reste du code
    return;
  }

  // Gestionnaire pour les boutons d'acceptation/refus
  if (interaction.isButton() && (interaction.customId.startsWith('accept_response_') || interaction.customId.startsWith('reject_response_'))) {
    console.log('Bouton de révision détecté:', interaction.customId);
    try {
      const isAccept = interaction.customId.startsWith('accept_response_');
      const [action, , formId, messageId, userId] = interaction.customId.split('_');
      console.log(`Tentative de ${isAccept ? 'acceptation' : 'refus'}: formId=${formId}, messageId=${messageId}, userId=${userId}`);
      
      // Vérifier les permissions
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return await interaction.reply({ content: 'Vous n\'avez pas la permission pour cette action.', ephemeral: true });
      }

      const form = client.forms[interaction.guildId]?.[formId];
      if (!form || !form.reviewOptions || !form.reviewOptions.enabled) {
        console.log('Formulaire introuvable ou révision désactivée:', formId);
        return await interaction.reply({ content: 'Formulaire introuvable ou révision désactivée.', ephemeral: true });
      }

      // Vérifier si les messages personnalisés sont activés
      if (form.reviewOptions.customMessagesEnabled) {
        // Créer un modal pour permettre au modérateur de saisir un message personnalisé
        const modal = new ModalBuilder()
          .setCustomId(`custom_message_${isAccept ? 'accept' : 'reject'}_${formId}_${messageId}_${userId}`)
          .setTitle(`Message personnalisé (${isAccept ? 'Acceptation' : 'Refus'})`)
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('custom_message_input')
                .setLabel('Message à envoyer à l\'utilisateur')
                .setPlaceholder(isAccept ? form.reviewOptions.acceptMessage : form.reviewOptions.rejectMessage)
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
            )
          );

        await interaction.showModal(modal);
        return; // On s'arrête ici car le traitement continue dans le gestionnaire de modal
      }

      // Si les messages personnalisés ne sont pas activés, on continue avec le comportement habituel
      // Déférer la réponse immédiatement
      await interaction.deferReply({ ephemeral: true });
      
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
            .setStyle(ButtonStyle.Secondary);
          
          const row = new ActionRowBuilder().addComponents(deleteButton);
          components = [row];
        }
        
        // Mettre à jour le message avec la nouvelle embed et les boutons appropriés
        await message.edit({ embeds: [updatedEmbed], components: components });
        
        // Log de l'action d'acceptation/refus
        await logToWebhookAndConsole(
          isAccept ? "✅ Réponse acceptée" : "❌ Réponse refusée", 
          `**${interaction.user.username}** a ${isAccept ? 'accepté' : 'refusé'} la réponse de **${userId ? `<@${userId}>` : 'utilisateur inconnu'}** au formulaire "${form.title}"`,
          [
            { name: "Modérateur", value: `${interaction.user.username} (ID: ${interaction.user.id})`, inline: true },
            { name: "Action", value: isAccept ? "Acceptation" : "Refus", inline: true },
            { name: "Formulaire", value: form.title, inline: true },
            { name: "Serveur", value: interaction.guild.name, inline: false },
            { name: "Lien", value: `[Voir la réponse](https://discord.com/channels/${interaction.guild.id}/${form.responseChannelId}/${messageId})`, inline: false }
          ],
          isAccept ? 0x57F287 : 0xED4245 // Vert si accepté, rouge si refusé
        );
        
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
                  console.log(`Erreur lors de l'ajout du rôle ${roleId} à ${userId}:`, err);
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
          console.log('Erreur lors de la notification de l\'utilisateur:', err);
        }
        
        await interaction.editReply({ 
          content: `La réponse a été ${isAccept ? 'acceptée' : 'refusée'} avec succès.`, 
          ephemeral: true 
        });
      } catch (error) {
        console.log('Erreur lors du traitement de la réponse:', error);
        await interaction.editReply({ 
          content: `Erreur lors du traitement de la réponse: ${error.message}`, 
          ephemeral: true 
        });
      }
    } catch (error) {
      console.log('Erreur générale lors du traitement de la révision:', error);
      try {
        if (!interaction.replied) {
          await interaction.reply({ content: 'Une erreur est survenue.', ephemeral: true });
        }
      } catch (e) {
        console.log('Impossible de répondre à l\'interaction:', e);
      }
    }
    return;
  }

  // Gestionnaire spécifique pour les modals de messages personnalisés
  if (interaction.isModalSubmit() && interaction.customId.startsWith('custom_message_')) {
    try {
      await interaction.deferReply({ ephemeral: true });
      
      const parts = interaction.customId.split('_');
      const isAccept = parts[2] === 'accept';
      const formId = parts[3];
      const messageId = parts[4];
      const userId = parts[5];
      
      console.log(`Traitement du message personnalisé pour ${isAccept ? 'acceptation' : 'refus'}: formId=${formId}, messageId=${messageId}, userId=${userId}`);
      
      const form = client.forms[interaction.guildId]?.[formId];
      if (!form || !form.reviewOptions || !form.reviewOptions.enabled) {
        console.log('Formulaire introuvable ou révision désactivée:', formId);
        return await interaction.editReply({ content: 'Formulaire introuvable ou révision désactivée.', ephemeral: true });
      }
      
      // Récupérer le message personnalisé saisi
      const customMessage = interaction.fields.getTextInputValue('custom_message_input');
      const defaultMessage = isAccept 
        ? (form.reviewOptions.acceptMessage || 'Votre réponse a été acceptée.')
        : (form.reviewOptions.rejectMessage || 'Votre réponse a été refusée.');
      
      const messageToSend = customMessage || defaultMessage;
      
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
            .setStyle(ButtonStyle.Secondary);
          
          const row = new ActionRowBuilder().addComponents(deleteButton);
          components = [row];
        }
        
        // Mettre à jour le message avec la nouvelle embed et les boutons appropriés
        await message.edit({ embeds: [updatedEmbed], components: components });
        
        // Log de l'action d'acceptation/refus
        await logToWebhookAndConsole(
          isAccept ? "✅ Réponse acceptée (Message personnalisé)" : "❌ Réponse refusée (Message personnalisé)", 
          `**${interaction.user.username}** a ${isAccept ? 'accepté' : 'refusé'} la réponse de **${userId ? `<@${userId}>` : 'utilisateur inconnu'}** au formulaire "${form.title}" avec un message personnalisé`,
          [
            { name: "Modérateur", value: `${interaction.user.username} (ID: ${interaction.user.id})`, inline: true },
            { name: "Action", value: isAccept ? "Acceptation" : "Refus", inline: true },
            { name: "Formulaire", value: form.title, inline: true },
            { name: "Message personnalisé", value: messageToSend.substring(0, 1000), inline: false },
            { name: "Serveur", value: interaction.guild.name, inline: false },
            { name: "Lien", value: `[Voir la réponse](https://discord.com/channels/${interaction.guild.id}/${form.responseChannelId}/${messageId})`, inline: false }
          ],
          isAccept ? 0x57F287 : 0xED4245 // Vert si accepté, rouge si refusé
        );
        
        // Notifier le membre avec le message personnalisé
        try {
          if (userId) {
            const target = await client.users.fetch(userId);
            await target.send(messageToSend);
            
            // Ajouter le rôle si spécifié et si l'utilisateur est dans le serveur
            const member = await interaction.guild.members.fetch(userId).catch(() => null);
            if (member) {
              const roleId = isAccept ? form.reviewOptions.acceptRoleId : form.reviewOptions.rejectRoleId;
              if (roleId) {
                await member.roles.add(roleId).catch(err => {
                  console.log(`Erreur lors de l'ajout du rôle ${roleId} à ${userId}:`, err);
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
          console.log('Erreur lors de la notification de l\'utilisateur:', err);
          await interaction.editReply({ 
            content: `La réponse a été ${isAccept ? 'acceptée' : 'refusée'} avec succès, mais il y a eu une erreur lors de l'envoi du message à l'utilisateur.`, 
            ephemeral: true 
          });
          return;
        }
        
        await interaction.editReply({ 
          content: `La réponse a été ${isAccept ? 'acceptée' : 'refusée'} avec succès et le message personnalisé a été envoyé.`, 
          ephemeral: true 
        });
      } catch (error) {
        console.log('Erreur lors du traitement de la réponse:', error);
        await interaction.editReply({ 
          content: `Erreur lors du traitement de la réponse: ${error.message}`, 
          ephemeral: true 
        });
      }
    } catch (error) {
      console.log('Erreur générale lors du traitement du message personnalisé:', error);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Une erreur est survenue.', ephemeral: true });
        } else if (interaction.deferred) {
          await interaction.editReply({ content: 'Une erreur est survenue.', ephemeral: true });
        }
      } catch (e) {
        console.log('Impossible de répondre à l\'interaction:', e);
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
      console.log(error);
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
            .setMaxLength(q.style === 'PARAGRAPH' ? 1024 : 256) // Limite de 1024 caractères pour réponses longues
        )
      ));
      
      try {
        await interaction.showModal(modal);
      } catch (error) {
        console.log('Erreur lors de l\'affichage du modal:', error);
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
            .setMaxLength(q.style === 'PARAGRAPH' ? 1024 : 256) // Limite de 1024 caractères pour réponses longues
        )
      ));
      
      try {
        await interaction.showModal(modal);
      } catch (error) {
        console.log('Erreur lors de l\'affichage du modal:', error);
        await interaction.reply({ 
          content: 'Une erreur est survenue lors de l\'ouverture du formulaire. Veuillez réessayer.', 
          ephemeral: true 
        });
      }
    }
  } else if (interaction.isModalSubmit()) {
    // Gestion des étapes du formulaire
    if (interaction.customId.startsWith('form_step_')) {
      const [, , formId, currentStep] = interaction.customId.split('_');
      const currentStepNum = parseInt(currentStep);
      const form = client.forms[interaction.guildId]?.[formId];
      
      if (!form) return interaction.reply({ content: 'Formulaire introuvable.', ephemeral: true });
      
      // Récupérer les réponses de cette étape
      const questionsPerStep = 5;
      const startIdx = currentStepNum * questionsPerStep;
      const endIdx = Math.min(startIdx + questionsPerStep, form.questions.length);
      const answers = {};
      
      for (let i = startIdx; i < endIdx; i++) {
        answers[i] = interaction.fields.getTextInputValue(`answer_${i}`);
      }
      
      // Stocker les réponses temporaires
      const userId = interaction.user.id;
      const userTempKey = `${userId}_${formId}`;
      
      if (!client.tempResponses.has(userTempKey)) {
        client.tempResponses.set(userTempKey, {});
      }
      
      // Fusionner les réponses existantes avec les nouvelles
      const userResponses = client.tempResponses.get(userTempKey);
      for (const [idx, answer] of Object.entries(answers)) {
        userResponses[idx] = answer;
      }
      
      // Vérifier s'il reste des questions
      const totalQuestions = form.questions.length;
      const totalSteps = Math.ceil(totalQuestions / questionsPerStep);
      const isLastStep = currentStepNum >= totalSteps - 1;
      
      if (isLastStep) {
        // C'est la dernière étape, traiter toutes les réponses
        const allAnswers = [];
        for (let i = 0; i < totalQuestions; i++) {
          allAnswers.push(userResponses[i]);
        }
        
        // Créer l'embed avec toutes les réponses
        const resultEmbed = new EmbedBuilder()
          .setTitle('Nouvelles réponses')
          .setAuthor({ name: `${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
          .addFields(form.questions.map((q, i) => ({ name: q.text, value: allAnswers[i] })));
        
        const targetChannel = await client.channels.fetch(form.responseChannelId);
        
        // Envoyer d'abord le message pour avoir l'ID
        const sent = await targetChannel.send({ embeds: [resultEmbed] });
        const messageId = sent.id;
        
        // Construction des boutons selon les options
        const buttons = [];
        
        // Ajouter le bouton de suppression si c'est un formulaire à réponse unique
        if (form.singleResponse) {
          const deleteButton = new ButtonBuilder()
            .setCustomId(`delete_response_${formId}_${messageId}`)
            .setLabel('Supprimer la réponse')
            .setStyle(ButtonStyle.Secondary);
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
        
        // Supprimer les réponses temporaires
        client.tempResponses.delete(userTempKey);

        // Log de soumission de formulaire complet
        await logToWebhookAndConsole(
          "📝 Formulaire soumis", 
          `**${interaction.user.username}** a terminé le formulaire "${form.title}" (${totalQuestions} questions)`,
          [
            { name: "Utilisateur", value: `${interaction.user.username} (ID: ${interaction.user.id})`, inline: true },
            { name: "Formulaire", value: form.title, inline: true },
            { name: "Serveur", value: interaction.guild.name, inline: true },
            { name: "Lien", value: `[Voir la réponse](https://discord.com/channels/${interaction.guild.id}/${form.responseChannelId}/${messageId})`, inline: false }
          ],
          0x57F287 // Couleur verte
        );
        
        await interaction.reply({ content: 'Merci pour vos réponses ! Le formulaire est maintenant complété.', ephemeral: true });
      } else {
        // Il reste encore des étapes, afficher un message avec un bouton pour continuer
        const nextStep = currentStepNum + 1;
        
        const embed = new EmbedBuilder()
          .setTitle(`${form.title} - Étape ${currentStepNum + 1}/${totalSteps}`)
          .setDescription("Le formulaire n'est pas encore terminé. Veuillez cliquer sur le bouton ci-dessous pour continuer.")
          .setColor('#ED4245'); // Rouge pour attirer l'attention
          
        const nextButton = new ButtonBuilder()
          .setCustomId(`next_step_${formId}_${nextStep}`)
          .setLabel('Étape Suivante')
          .setStyle(ButtonStyle.Primary);
          
        const row = new ActionRowBuilder().addComponents(nextButton);
        
        await interaction.reply({ 
          embeds: [embed], 
          components: [row], 
          ephemeral: true 
        });
      }
      
      return;
    }
    
    if (interaction.customId.startsWith('fill_modal_')) {
    // Traitement spécial pour les réponses aux formulaires (pas de formBuilder)
    const formId = interaction.customId.split('_')[2];
    const form = client.forms[interaction.guildId]?.[formId];
    if (!form) return interaction.reply({ content: 'Formulaire introuvable.', ephemeral: true });
    
    // Vérifier si l'utilisateur a déjà répondu (si singleResponse est activé)
    if (form.singleResponse && form.respondents && form.respondents[interaction.user.id]) {
      // Log de tentative de réponse multiple
      await logToWebhookAndConsole(
        "🚫 Tentative de réponse multiple", 
        `**${interaction.user.username}** a essayé de répondre à nouveau au formulaire "${form.title}" alors qu'il a déjà répondu.`,
        [
          { name: "Utilisateur", value: `${interaction.user.username} (ID: ${interaction.user.id})`, inline: true },
          { name: "Formulaire", value: form.title, inline: true },
          { name: "Serveur", value: interaction.guild.name, inline: true }
        ],
        0xFEE75C // Couleur jaune
      );
      
      return interaction.reply({ 
        content: 'Vous avez déjà répondu à ce formulaire. Vous ne pouvez pas répondre à nouveau.', 
        ephemeral: true 
      });
    }
    
    const answers = form.questions.map((_, i) => interaction.fields.getTextInputValue(`answer_${i}`));
    const resultEmbed = new EmbedBuilder()
      .setTitle('Nouvelles réponses')
      .setAuthor({ name: `${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
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
        .setStyle(ButtonStyle.Secondary);
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

    // Log de soumission de formulaire
    await logToWebhookAndConsole(
      "📝 Formulaire soumis", 
      `**${interaction.user.username}** a répondu au formulaire "${form.title}"`,
      [
        { name: "Utilisateur", value: `${interaction.user.username} (ID: ${interaction.user.id})`, inline: true },
        { name: "Formulaire", value: form.title, inline: true },
        { name: "Serveur", value: interaction.guild.name, inline: true },
        { name: "Lien", value: `[Voir la réponse](https://discord.com/channels/${interaction.guild.id}/${form.responseChannelId}/${messageId})`, inline: false }
      ],
      0x57F287 // Couleur verte
    );
    
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
app.use(session({
  secret: config.secretKey,
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: config.webserver.baseUrl.startsWith('https'),
    maxAge: 24 * 60 * 60 * 1000 // 24 heures
  }
}));

// Middleware pour gérer les en-têtes de proxy
app.set('trust proxy', true);

// Discord OAuth2 URLs
const DISCORD_API_URL = 'https://discord.com/api/v10';
const OAUTH_REDIRECT_URI = `${config.webserver.baseUrl}/auth/discord/callback`;
const OAUTH_SCOPES = ['identify', 'guilds', 'guilds.members.read'];

// Middleware pour vérifier si l'utilisateur est authentifié
function isAuthenticated(req, res, next) {
  if (!req.session.user) {
    // Stocker l'URL d'origine pour rediriger après l'authentification
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/discord');
  }
  next();
}

// Middleware pour vérifier les permissions Discord dans un serveur spécifique
async function hasGuildPermission(req, res, next) {
  const guildId = req.params.guildId || req.params.serverId;
  if (!guildId) {
    return res.status(400).send('ID du serveur manquant');
  }

  if (!req.session.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/discord');
  }

  try {
    // Obtenir les informations du serveur
    const guildResponse = await axios.get(`${DISCORD_API_URL}/users/@me/guilds`, {
      headers: {
        Authorization: `Bearer ${req.session.accessToken}`
      }
    }).catch(error => {
      console.log('Erreur lors de la récupération des serveurs:', error.response?.data || error.message);
      return { data: [] };
    });

    // Vérifier si l'utilisateur est membre du serveur et récupérer ses permissions
    const userGuild = guildResponse.data.find(guild => guild.id === guildId);
    
    if (!userGuild) {
      return res.status(403).send('Vous n\'êtes pas membre de ce serveur');
    }
    
    // Vérifier si l'utilisateur est le propriétaire du serveur
    const isOwner = userGuild.owner === true;
    
    // Vérifier les permissions (MANAGE_MESSAGES = 8192, ADMINISTRATOR = 8)
    const permissions = BigInt(userGuild.permissions || 0);
    const hasAdminPermission = (permissions & BigInt(0x8)) !== BigInt(0); // 0x8 = ADMINISTRATOR
    const hasManageMessagesPermission = (permissions & BigInt(0x2000)) !== BigInt(0); // 0x2000 = MANAGE_MESSAGES
    
    // Autoriser l'accès si l'utilisateur est propriétaire, administrateur ou a la permission de gérer les messages
    if (hasManageMessagesPermission) {
      // Récupérer plus d'informations sur le membre du serveur si nécessaire
      try {
        const memberResponse = await axios.get(`${DISCORD_API_URL}/users/@me/guilds/${guildId}/member`, {
          headers: {
            Authorization: `Bearer ${req.session.accessToken}`
          }
        }).catch(() => ({ data: null }));

        if (memberResponse.data) {
          req.guildMember = memberResponse.data;
        }
      } catch (memberError) {
        console.log('Impossible de récupérer les détails du membre, mais l\'utilisateur a les permissions nécessaires');
        // Ne pas échouer si on ne peut pas récupérer les détails du membre
      }
      
      // Ajouter les informations du serveur à la requête
      req.guild = userGuild;
      return next();
    }
    
    return res.status(403).send('Vous n\'avez pas les permissions nécessaires dans ce serveur');
  } catch (error) {
    console.log('Erreur lors de la vérification des permissions:', error);
    res.status(500).send('Erreur lors de la vérification des permissions');
  }
}

// Route d'authentification Discord
app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' ')
  });
  res.redirect(`${DISCORD_API_URL}/oauth2/authorize?${params.toString()}`);
});

// Route de succès après création/modification de formulaire
app.get('/success', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

// Route d'erreur générique
app.get('/error', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'error.html'));
});

// Route du tableau de bord
app.get('/dashboard', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Callback OAuth2 Discord - Amélioration avec gestion d'erreur
app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.redirect('/error?title=Erreur+d%27authentification&message=Code+d%27autorisation+manquant');
  }

  try {
    // Échanger le code contre un jeton d'accès
    const tokenResponse = await axios.post(`${DISCORD_API_URL}/oauth2/token`, 
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: OAUTH_REDIRECT_URI,
        scope: OAUTH_SCOPES.join(' ')
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const { access_token, expires_in, refresh_token } = tokenResponse.data;

    // Récupérer les informations de l'utilisateur
    const userResponse = await axios.get(`${DISCORD_API_URL}/users/@me`, {
      headers: {
        Authorization: `Bearer ${access_token}`
      }
    });

    // Stocker les informations dans la session
    req.session.accessToken = access_token;
    req.session.refreshToken = refresh_token;
    req.session.expiresAt = Date.now() + expires_in * 1000;
    req.session.user = userResponse.data;
    
    // Log de connexion au panel web
    await logToWebhookAndConsole(
      "👤 Connexion au panel web", 
      `**${userResponse.data.username}** s'est connecté au panel web.`,
      [
        { name: "Utilisateur", value: `${userResponse.data.username} (ID: ${userResponse.data.id})`, inline: true },
        { name: "Date", value: new Date().toLocaleString(), inline: true }
      ],
      0x5865F2 // Couleur bleu Discord
    );

    // Rediriger vers la page d'origine ou le tableau de bord par défaut
    const returnTo = req.session.returnTo || '/dashboard';
    delete req.session.returnTo;
    res.redirect(returnTo);
  } catch (error) {
    console.log('Erreur d\'authentification Discord:', error.response?.data || error.message);
    res.redirect('/error?title=Erreur+d%27authentification&message=Impossible+de+vous+authentifier+avec+Discord');
  }
});

// Déconnexion
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Route pour créer un nouveau formulaire
app.get('/create/:guildId', isAuthenticated, hasGuildPermission, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'editor.html'));
});

// Route pour modifier un formulaire existant
app.get('/edit/:guildId/:formId', isAuthenticated, hasGuildPermission, (req, res) => {
  const { guildId, formId } = req.params;
  const form = client.forms[guildId]?.[formId];
  
  if (!form) {
    return res.status(404).send('Formulaire introuvable');
  }
  
  res.sendFile(path.join(__dirname, 'public', 'editor.html'));
});

// API pour obtenir les données du formulaire
app.get('/api/form/:guildId/:formId', isAuthenticated, hasGuildPermission, (req, res) => {
  const { guildId, formId } = req.params;
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
  
  // Si formId est fourni, récupérer le formulaire existant
  let form = {
    title: '',
    questions: [],
    embedChannelId: null,
    responseChannelId: null,
    embedText: '',
    buttonLabel: 'Répondre',
    singleResponse: false,
    reviewOptions: { enabled: false, acceptMessage: '', rejectMessage: '', acceptRoleId: '', rejectRoleId: '' }
  };
  
  if (formId && client.forms[guildId]?.[formId]) {
    form = { ...client.forms[guildId][formId] };
  }
  
  res.json({
    form: form,
    channels: channels,
    roles: roles,
    user: req.session.user
  });
});

// Route pour obtenir un formulaire vide (pour nouvelle création)
app.get('/api/form/:guildId', isAuthenticated, hasGuildPermission, (req, res) => {
  const { guildId } = req.params;
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
  
  // Formulaire vide par défaut
  const form = {
    title: '',
    questions: [],
    embedChannelId: null,
    responseChannelId: null,
    embedText: '',
    buttonLabel: 'Répondre',
    singleResponse: false,
    reviewOptions: { enabled: false, acceptMessage: '', rejectMessage: '', acceptRoleId: '', rejectRoleId: '' }
  };
  
  res.json({
    form: form,
    channels: channels,
    roles: roles,
    user: req.session.user
  });
});

// API pour sauvegarder le formulaire - Mise à jour pour rediriger vers la page de succès
app.post('/api/form/:guildId/:formId', isAuthenticated, hasGuildPermission, async (req, res) => {
  const { guildId, formId } = req.params;
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
    const finalFormId = formId || Date.now().toString();
    
    // Récupérer l'ID du message existant si c'est une modification
    const existingMessageId = formId && client.forms[guildId][finalFormId]?.embedMessageId;
    
    // Stocker l'ancien formulaire pour les logs
    const oldForm = client.forms[guildId][finalFormId] ? {...client.forms[guildId][finalFormId]} : null;
    
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
      respondents: formId && client.forms[guildId][finalFormId]?.respondents ? 
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
        console.log(`Impossible de modifier le message existant ${existingMessageId}, création d'un nouveau:`, error);
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
    
    // Log de modification de formulaire
    if (oldForm) {
      const guild = client.guilds.cache.get(guildId);
      await logToWebhookAndConsole(
        "📝 Modification de formulaire", 
        `**${req.session.user.username}** a modifié le formulaire "${updatedForm.title}" sur le serveur **${guild?.name || guildId}**`,
        [
          { name: "Titre", value: updatedForm.title, inline: true },
          { name: "Questions", value: `${updatedForm.questions.length}`, inline: true },
          { name: "Serveur", value: guild?.name || guildId, inline: true },
          { name: "Utilisateur", value: `${req.session.user.username} (ID: ${req.session.user.id})`, inline: false },
          { name: "Modifications", value: `Canal embed: ${oldForm.embedChannelId !== updatedForm.embedChannelId ? '✅' : '❌'}\nCanal réponses: ${oldForm.responseChannelId !== updatedForm.responseChannelId ? '✅' : '❌'}\nQuestions: ${JSON.stringify(oldForm.questions) !== JSON.stringify(updatedForm.questions) ? '✅' : '❌'}`, inline: false }
        ],
        0xFEE75C // Couleur jaune
      );
    }
    
    res.json({ success: true, redirect: '/success' });
  } catch (error) {
    console.log('Erreur lors de la sauvegarde du formulaire:', error);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde du formulaire', details: error.message });
  }
});

// API pour sauvegarder un nouveau formulaire - Mise à jour pour rediriger vers la page de succès
app.post('/api/form/:guildId', isAuthenticated, hasGuildPermission, async (req, res) => {
  const { guildId } = req.params;
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
    const finalFormId = Date.now().toString();
    
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
      embedMessageId: null,
      respondents: {}
    };
    
    // Créer l'embed Discord
    const embedChan = await client.channels.fetch(updatedForm.embedChannelId);
    const btn = new ButtonBuilder()
      .setCustomId(`fill_${finalFormId}`)
      .setLabel(updatedForm.buttonLabel)
      .setStyle(ButtonStyle.Primary);
    
    const formEmbed = new EmbedBuilder()
      .setTitle(updatedForm.title)
      .setDescription(updatedForm.embedText);
    
    // Nouveau formulaire, envoyer un nouveau message
    const sentMessage = await embedChan.send({
      embeds: [formEmbed],
      components: [new ActionRowBuilder().addComponents(btn)]
    });
    console.log(`Nouveau message de formulaire créé: ${sentMessage.id}`);
    
    // Mettre à jour l'ID du message
    client.forms[guildId][finalFormId].embedMessageId = sentMessage.id;
    
    // Sauvegarder dans le fichier
    fs.writeJsonSync(client.formsPath, client.forms, { spaces: 2 });
    
    // Log de création de formulaire
    const guild = client.guilds.cache.get(guildId);
    await logToWebhookAndConsole(
      "✨ Création de formulaire", 
      `**${req.session.user.username}** a créé un nouveau formulaire "${updatedForm.title}" sur le serveur **${guild?.name || guildId}**`,
      [
        { name: "Titre", value: updatedForm.title, inline: true },
        { name: "Questions", value: `${updatedForm.questions.length}`, inline: true },
        { name: "Serveur", value: guild?.name || guildId, inline: true },
        { name: "Utilisateur", value: `${req.session.user.username} (ID: ${req.session.user.id})`, inline: false }
      ],
      0x3498DB // Couleur bleue
    );
    
    res.json({ success: true, formId: finalFormId, redirect: '/success' });
  } catch (error) {
    console.log('Erreur lors de la sauvegarde du formulaire:', error);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde du formulaire', details: error.message });
  }
});

// Page d'accueil simple
app.get('/', (req, res) => {
  if (req.session.user) {
    res.redirect('/dashboard');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// Liste des serveurs de l'utilisateur
app.get('/api/guilds', isAuthenticated, async (req, res) => {
  try {
    // Récupérer tous les serveurs de l'utilisateur
    const guildsResponse = await axios.get(`${DISCORD_API_URL}/users/@me/guilds`, {
      headers: {
        Authorization: `Bearer ${req.session.accessToken}`
      }
    });
    
    // Filtrer pour ne garder que les serveurs où l'utilisateur a la permission MANAGE_MESSAGES
    // ou est administrateur ou propriétaire
    const managableGuilds = guildsResponse.data.filter(guild => {
      const permissions = BigInt(guild.permissions);
      return (permissions & BigInt(0x2000)) !== BigInt(0); // MANAGE_MESSAGES uniquement
    });
    
    // Vérifier si le bot est présent dans ces serveurs
    const botGuilds = client.guilds.cache;
    
    // Ne garder que les serveurs où le bot est présent
    const availableGuilds = managableGuilds.filter(guild => 
      botGuilds.has(guild.id)
    );
    
    // Ajouter des informations sur les formulaires existants
    const guildsWithFormInfo = availableGuilds.map(guild => {
      const formCount = client.forms[guild.id] ? Object.keys(client.forms[guild.id]).length : 0;
      return {
        ...guild,
        formCount
      };
    });
    
    res.json(guildsWithFormInfo);
  } catch (error) {
    console.log('Erreur lors de la récupération des serveurs:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des serveurs' });
  }
});

// Liste des formulaires d'un serveur
app.get('/api/forms/:guildId', isAuthenticated, hasGuildPermission, (req, res) => {
  const { guildId } = req.params;
  
  // Vérifier si le serveur a des formulaires
  if (!client.forms[guildId] || Object.keys(client.forms[guildId]).length === 0) {
    return res.json([]);
  }
  
  // Formatter les formulaires en tableau
  const forms = Object.entries(client.forms[guildId]).map(([id, form]) => ({
    id,
    title: form.title,
    questions: form.questions,
    embedChannelId: form.embedChannelId,
    responseChannelId: form.responseChannelId,
    embedText: form.embedText,
    buttonLabel: form.buttonLabel,
    singleResponse: form.singleResponse,
    reviewOptions: form.reviewOptions,
    embedMessageId: form.embedMessageId,
    respondents: form.respondents || {},
    disabled: form.disabled || false  // ajout du statut
  }));
  
  res.json(forms);
});

// Supprimer un formulaire
app.delete('/api/forms/:guildId/:formId', isAuthenticated, hasGuildPermission, async (req, res) => {
  const { guildId, formId } = req.params;
  
  try {
    // Vérifier si le formulaire existe
    if (!client.forms[guildId] || !client.forms[guildId][formId]) {
      return res.status(404).json({ error: 'Formulaire introuvable' });
    }
    
    // Récupérer les informations du formulaire pour le log
    const form = client.forms[guildId][formId];
    const guild = client.guilds.cache.get(guildId);
    
    // Supprimer l'embed du message Discord si possible
    if (form.embedMessageId && form.embedChannelId) {
      try {
        const channel = await client.channels.fetch(form.embedChannelId);
        const message = await channel.messages.fetch(form.embedMessageId);
        await message.delete();
        console.log(`Message de formulaire supprimé: ${form.embedMessageId}`);
      } catch (error) {
        console.log(`Impossible de supprimer le message Discord: ${error.message}`);
        // On continue même si le message ne peut pas être supprimé
      }
    }
    
    // Supprimer le formulaire de la collection
    delete client.forms[guildId][formId];
    
    // Si c'était le dernier formulaire du serveur, supprimer l'entrée du serveur
    if (Object.keys(client.forms[guildId]).length === 0) {
      delete client.forms[guildId];
    }
    
    // Sauvegarder les modifications
    fs.writeJsonSync(client.formsPath, client.forms, { spaces: 2 });
    
    // Log de suppression de formulaire
    await logToWebhookAndConsole(
      "🗑️ Suppression de formulaire", 
      `**${req.session.user.username}** a supprimé le formulaire "${form.title}" du serveur **${guild?.name || guildId}**`,
      [
        { name: "Titre", value: form.title, inline: true },
        { name: "Serveur", value: guild?.name || guildId, inline: true },
        { name: "Utilisateur", value: `${req.session.user.username} (ID: ${req.session.user.id})`, inline: false }
      ],
      0xED4245 // Couleur rouge
    );
    
    res.json({ success: true });
  } catch (error) {
    console.log('Erreur lors de la suppression du formulaire:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression du formulaire' });
  }
});

// Route pour activer/désactiver un formulaire
app.post('/api/forms/:guildId/:formId/toggle', isAuthenticated, hasGuildPermission, async (req, res) => {
  const { guildId, formId } = req.params;
  const { status } = req.body;
  
  try {
    // Vérifier si le formulaire existe
    if (!client.forms[guildId] || !client.forms[guildId][formId]) {
      return res.status(404).json({ error: 'Formulaire introuvable' });
    }
    
    // Récupérer les informations du formulaire pour le log
    const form = client.forms[guildId][formId];
    const guild = client.guilds.cache.get(guildId);
    
    // Mettre à jour le statut du formulaire
    const isDisabled = status === 'disabled';
    client.forms[guildId][formId].disabled = isDisabled;
    
    // Mettre à jour l'embed Discord si possible
    if (form.embedMessageId && form.embedChannelId) {
      try {
        const channel = await client.channels.fetch(form.embedChannelId);
        const message = await channel.messages.fetch(form.embedMessageId);
        
        // Récupérer l'embed existant
        const embed = message.embeds[0];
        
        // Créer un nouveau bouton avec le statut correct
        const btn = new ButtonBuilder()
          .setCustomId(`fill_${formId}`)
          .setLabel(form.buttonLabel)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(isDisabled);
        
        // Mettre à jour le message avec le nouveau bouton
        await message.edit({
          embeds: [embed],
          components: [new ActionRowBuilder().addComponents(btn)]
        });
        
        console.log(`Message de formulaire mis à jour avec statut ${isDisabled ? 'désactivé' : 'activé'}: ${form.embedMessageId}`);
      } catch (error) {
        console.log(`Impossible de mettre à jour le message Discord: ${error.message}`);
        // On continue même si le message ne peut pas être mis à jour
      }
    }
    
    // Sauvegarder les modifications
    fs.writeJsonSync(client.formsPath, client.forms, { spaces: 2 });
    
    // Log de changement de statut du formulaire
    await logToWebhookAndConsole(
      isDisabled ? "🔴 Formulaire désactivé" : "🟢 Formulaire activé", 
      `**${req.session.user.username}** a ${isDisabled ? 'désactivé' : 'activé'} le formulaire "${form.title}" du serveur **${guild?.name || guildId}**`,
      [
        { name: "Titre", value: form.title, inline: true },
        { name: "Serveur", value: guild?.name || guildId, inline: true },
        { name: "Utilisateur", value: `${req.session.user.username} (ID: ${req.session.user.id})`, inline: false }
      ],
      isDisabled ? 0xFEE75C : 0x57F287 // Jaune si désactivé, vert si activé
    );
    
    res.json({ success: true, status: status });
  } catch (error) {
    console.log('Erreur lors de la modification du statut du formulaire:', error);
    res.status(500).json({ error: 'Erreur lors de la modification du statut du formulaire' });
  }
});

// Récupérer les informations de l'utilisateur
app.get('/api/user', isAuthenticated, (req, res) => {
  res.json(req.session.user);
});

// Gestion des erreurs 404
app.use((req, res) => {
  res.redirect('/error?title=Page+non+trouvée&message=La+page+demandée+n%27existe+pas');
});

// Démarrage étape par étape
(async () => {
  console.log('\n--- Démarrage du bot FormsBot ---');
  console.log('1. Chargement de la configuration...');
  // config déjà chargé
  console.log('2. Chargement des commandes...');
  const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
  console.log(`   → ${commandFiles.length} commandes trouvées.`);
  console.log('3. Initialisation du client Discord...');
  // client déjà créé
  console.log('4. Chargement des formulaires...');
  let forms = fs.existsSync(formsPath) ? fs.readJsonSync(formsPath) : {};
  console.log(`   → ${Object.keys(forms).length} serveurs avec formulaires.`);
  console.log('5. Connexion à Discord...');
})();

// Démarrer le serveur
server.listen(config.webserver.port, () => {
  console.log(`Serveur web démarré sur le port ${config.webserver.port}`);
});

client.login(config.token);
