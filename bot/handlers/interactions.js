const { checkClartyBlacklist } = require('../../utils/clarty.js');
const { logToWebhookAndConsole } = require('../../utils/logger.js');
const { loadCooldowns, saveCooldowns, formatCooldownDuration } = require('../../utils/cooldowns.js');
const fs = require('fs-extra');
const { 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  PermissionsBitField
} = require('discord.js');

async function handleInteractions(interaction, client) {
  try {
    // Gestionnaire pour les boutons de suppression de réponse
    if (interaction.isButton() && interaction.customId.startsWith('delete_response_')) {
      return await handleResponseDeletion(interaction, client);
    }

    // Gestionnaire pour les boutons d'acceptation/rejet de réponses
    if (interaction.isButton() && (interaction.customId.startsWith('accept_response_') || interaction.customId.startsWith('reject_response_'))) {
      return await handleResponseReview(interaction, client);
    }

    // Gestionnaire pour les modals de messages personnalisés
    if (interaction.isModalSubmit() && interaction.customId.startsWith('custom_message_')) {
      return await handleCustomMessageModal(interaction, client);
    }

    // Gestionnaire pour les boutons de soumission de formulaires
    if (interaction.isButton() && (interaction.customId.startsWith('fill_') || interaction.customId.startsWith('continue_form_'))) {
      return await handleFormSubmission(interaction, client);
    }

    // Gestionnaire pour les commandes slash
    if (interaction.isChatInputCommand()) {
      return await handleSlashCommand(interaction, client);
    }

    // Gestionnaire pour les boutons du form builder
    if (interaction.isButton() && ['add_question', 'remove_question', 'set_title', 'finish_form', 'choose_embed_channel', 'choose_response_channel', 'set_embed_text', 'set_button_label'].includes(interaction.customId)) {
      const { handleFormBuilder } = require('./formBuilder.js');
      return await handleFormBuilder(interaction, client);
    }

    // Gestionnaire pour les soumissions de formulaires
    if (interaction.isModalSubmit() && interaction.customId.startsWith('fill_modal_')) {
      return await handleFormModalSubmission(interaction, client);
    }

    // Gestionnaire pour les modals du form builder
    if (interaction.isModalSubmit() && ['question_modal', 'title_modal', 'embed_text_modal', 'button_label_modal'].includes(interaction.customId)) {
      const { handleFormBuilder } = require('./formBuilder.js');
      return await handleFormBuilder(interaction, client);
    }

    // Gestionnaire pour les menus de sélection du form builder
    if (interaction.isStringSelectMenu() && ['remove_question_select'].includes(interaction.customId)) {
      const { handleFormBuilder } = require('./formBuilder.js');
      return await handleFormBuilder(interaction, client);
    }

    // Gestionnaire pour les menus de sélection de canaux du form builder
    if (interaction.isChannelSelectMenu() && ['embed_channel_select', 'response_channel_select'].includes(interaction.customId)) {
      const { handleFormBuilder } = require('./formBuilder.js');
      return await handleFormBuilder(interaction, client);
    }

  } catch (error) {
    console.error('Erreur dans le gestionnaire d\'interactions:', error);
    
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'Une erreur est survenue lors du traitement de votre interaction.',
        ephemeral: true
      });
    }
  }
}

async function handleSlashCommand(interaction, client) {
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, client);
  } catch (error) {
    console.error('Erreur lors de l\'exécution de la commande:', error);
    
    const errorMessage = 'Il y a eu une erreur lors de l\'exécution de cette commande !';
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}

async function handleFormSubmission(interaction, client) {
  const customIdParts = interaction.customId.split('_');
  const formId = customIdParts.length > 2 ? customIdParts[2] : customIdParts[1];
  const guildId = interaction.guild.id;
  const step = interaction.customId.startsWith('continue_form_') ? parseInt(customIdParts[3], 10) : 1;

  // Vérifier si le formulaire existe
  const form = client.forms[guildId]?.[formId];
  if (!form) {
    return await interaction.reply({
      content: 'Ce formulaire n\'existe plus.',
      ephemeral: true
    });
  }

  // Vérifier si le formulaire est désactivé
  if (form.disabled) {
    return await interaction.reply({
      content: 'Ce formulaire est actuellement désactivé.',
      ephemeral: true
    });
  }

  // Vérifier la blacklist locale
  if (client.isUserBlacklisted(guildId, interaction.user.id)) {
    return await interaction.reply({
      content: 'Vous êtes blacklisté de ce serveur et ne pouvez pas répondre aux formulaires.',
      ephemeral: true
    });
  }

  // Vérifier Clarty OpenBL si activé
  if (form.clartyProtection) {
    const blacklistCheck = await checkClartyBlacklist(interaction.user.id);
    if (blacklistCheck.isBlacklisted) {
      const reason = blacklistCheck.userData?.blacklisted_reasons?.fr_fr || 
                    blacklistCheck.userData?.blacklisted_reasons?.en_gb || 
                    'Utilisateur blacklisté';
      
      await logToWebhookAndConsole(
        "🚫 Tentative bloquée par Clarty",
        `**${interaction.user.username}** (blacklisté) a tenté de répondre au formulaire "${form.title}"`,
        [
          { name: "Utilisateur", value: `${interaction.user.username} (ID: ${interaction.user.id})`, inline: true },
          { name: "Formulaire", value: form.title, inline: true },
          { name: "Serveur", value: interaction.guild.name, inline: true },
          { name: "Raison", value: reason, inline: false }
        ],
        0xED4245
      );

      return await interaction.reply({
        content: `Vous êtes blacklisté et ne pouvez pas répondre à ce formulaire.\nRaison: ${reason}`,
        ephemeral: true
      });
    }
  }

  // Vérifier les cooldowns
  if (form.cooldownOptions?.enabled && client.premiumGuilds.includes(guildId)) {
    const cooldowns = loadCooldowns();
    const userCooldown = cooldowns[guildId]?.[formId]?.[interaction.user.id];
    
    if (userCooldown && userCooldown > Date.now()) {
      const timeLeft = userCooldown - Date.now();
      const minutesLeft = Math.ceil(timeLeft / (1000 * 60));
      
      return await interaction.reply({
        content: `Vous devez attendre ${formatCooldownDuration(minutesLeft)} avant de pouvoir répondre à nouveau à ce formulaire.`,
        ephemeral: true
      });
    }
  }

  // Vérifier les réponses uniques
  if (form.singleResponse && form.respondents && form.respondents[interaction.user.id]) {
    return await interaction.reply({
      content: 'Vous avez déjà répondu à ce formulaire.',
      ephemeral: true
    });
  }

  // Créer le modal avec les questions du formulaire
  const modal = new ModalBuilder()
    .setCustomId(`fill_modal_${formId}_${step}`)
    .setTitle(form.title.length > 45 ? form.title.substring(0, 42) + '...' : form.title);

  // Ajouter les questions pour l'étape actuelle
  const questionsPerPage = 5;
  const startIndex = (step - 1) * questionsPerPage;
  const endIndex = startIndex + questionsPerPage;
  const questions = form.questions.slice(startIndex, endIndex);
  
  questions.forEach((question, index) => {
    const textInput = new TextInputBuilder()
      .setCustomId(`question_${startIndex + index}`)
      .setLabel(question.text.length > 45 ? question.text.substring(0, 42) + '...' : question.text)
      .setStyle(question.style === 'PARAGRAPH' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(true);

    const actionRow = new ActionRowBuilder().addComponents(textInput);
    modal.addComponents(actionRow);
  });

  await interaction.showModal(modal);
}

async function handleFormModalSubmission(interaction, client) {
  const customIdParts = interaction.customId.split('_');
  const formId = customIdParts[2];
  const step = parseInt(customIdParts[3], 10);
  const guildId = interaction.guild.id;
  
  const form = client.forms[guildId]?.[formId];
  if (!form) {
    return await interaction.reply({
      content: 'Ce formulaire n\'existe plus.',
      ephemeral: true
    });
  }

  // Initialiser le stockage des réponses pour l'utilisateur si nécessaire
  if (!client.formResponses) {
    client.formResponses = {};
  }
  if (!client.formResponses[interaction.user.id]) {
    client.formResponses[interaction.user.id] = {
      formId: formId,
      responses: []
    };
  }

  // Récupérer et stocker les réponses de l'étape actuelle
  interaction.fields.fields.forEach((field, customId) => {
    const questionIndex = parseInt(customId.split('_')[1]);
    client.formResponses[interaction.user.id].responses[questionIndex] = {
      question: form.questions[questionIndex].text,
      answer: field.value
    };
  });

  // Vérifier s'il y a d'autres étapes
  const questionsPerPage = 5;
  const totalSteps = Math.ceil(form.questions.length / questionsPerPage);
  if (step < totalSteps) {
    // Il y a d'autres étapes, envoyer un message pour continuer
    const nextStep = step + 1;
    const embed = new EmbedBuilder()
      .setColor(0xED4245) // Rouge
      .setTitle(`Étape ${step}/${totalSteps} terminée`)
      .setDescription(`Vous avez terminé l\'étape ${step} sur ${totalSteps}. Cliquez sur le bouton ci-dessous pour continuer.`);

    const continueButton = new ButtonBuilder()
      .setCustomId(`continue_form_${formId}_${nextStep}`)
      .setLabel('Continuer')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(continueButton);

    return await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true
    });
  }

  // C'est la dernière étape, traiter la soumission complète
  const responses = client.formResponses[interaction.user.id].responses.filter(r => r); // Nettoyer les éléments vides
  delete client.formResponses[interaction.user.id]; // Nettoyer les réponses stockées

  // Marquer le cooldown si activé
  if (form.cooldownOptions?.enabled && client.premiumGuilds.includes(guildId)) {
    const cooldowns = loadCooldowns();
    if (!cooldowns[guildId]) cooldowns[guildId] = {};
    if (!cooldowns[guildId][formId]) cooldowns[guildId][formId] = {};
    
    const cooldownEnd = Date.now() + (form.cooldownOptions.duration * 60 * 1000);
    cooldowns[guildId][formId][interaction.user.id] = cooldownEnd;
    saveCooldowns(cooldowns);
  }

  // Marquer comme répondu si réponse unique
  if (form.singleResponse) {
    client.forms[guildId][formId].respondents = client.forms[guildId][formId].respondents || {};
    client.forms[guildId][formId].respondents[interaction.user.id] = Date.now();
    fs.writeJsonSync(client.formsPath, client.forms, { spaces: 2 });
  }

  // Créer l'embed de réponse
  const responseEmbed = new EmbedBuilder()
    .setTitle(`📝 Nouvelle réponse au formulaire: ${form.title}`)
    .setColor(0x3498db)
    .setAuthor({
      name: interaction.user.username,
      iconURL: interaction.user.displayAvatarURL()
    })
    .setTimestamp();

  responses.forEach((resp, index) => {
    responseEmbed.addFields({
      name: `${index + 1}. ${resp.question}`,
      value: resp.answer.length > 1024 ? resp.answer.substring(0, 1021) + '...' : resp.answer,
      inline: false
    });
  });

  // Envoyer la réponse au canal configuré
  try {
    const responseChannel = await client.channels.fetch(form.responseChannelId);
    let sentMessage;
    
    if (form.reviewOptions?.enabled) {
      // Si révision activée, ajouter des boutons d'acceptation/refus + suppression
      const acceptButton = new ButtonBuilder()
        .setCustomId(`accept_response_${formId}_${interaction.user.id}`)
        .setLabel('✅ Accepter')
        .setStyle(ButtonStyle.Success);
        
      const rejectButton = new ButtonBuilder()
        .setCustomId(`reject_response_${formId}_${interaction.user.id}`)
        .setLabel('❌ Rejeter')
        .setStyle(ButtonStyle.Danger);

      const deleteButton = new ButtonBuilder()
        .setCustomId(`delete_response_${formId}_temp`)
        .setLabel('🗑️ Supprimer')
        .setStyle(ButtonStyle.Secondary);

      const actionRow = new ActionRowBuilder().addComponents(acceptButton, rejectButton, deleteButton);
      
      sentMessage = await responseChannel.send({
        embeds: [responseEmbed],
        components: [actionRow]
      });
      
      // Mettre à jour l'ID du message dans le bouton de suppression
      const updatedDeleteButton = new ButtonBuilder()
        .setCustomId(`delete_response_${formId}_${sentMessage.id}`)
        .setLabel('🗑️ Supprimer')
        .setStyle(ButtonStyle.Secondary);

      const updatedActionRow = new ActionRowBuilder().addComponents(acceptButton, rejectButton, updatedDeleteButton);
      
      await sentMessage.edit({
        embeds: [responseEmbed],
        components: [updatedActionRow]
      });
    } else {
      // Si pas de révision, ajouter seulement le bouton de suppression
      const deleteButton = new ButtonBuilder()
        .setCustomId(`delete_response_${formId}_temp`)
        .setLabel('🗑️ Supprimer la réponse')
        .setStyle(ButtonStyle.Secondary);

      const actionRow = new ActionRowBuilder().addComponents(deleteButton);
      
      sentMessage = await responseChannel.send({
        embeds: [responseEmbed],
        components: [actionRow]
      });
      
      // Mettre à jour l'ID du message dans le bouton de suppression
      const updatedDeleteButton = new ButtonBuilder()
        .setCustomId(`delete_response_${formId}_${sentMessage.id}`)
        .setLabel('🗑️ Supprimer la réponse')
        .setStyle(ButtonStyle.Secondary);

      const updatedActionRow = new ActionRowBuilder().addComponents(updatedDeleteButton);
      
      await sentMessage.edit({
        embeds: [responseEmbed],
        components: [updatedActionRow]
      });
    }
    
    // Créer un thread si activé (en utilisant le message déjà envoyé)
    if (form.createThreads && sentMessage) {
      await sentMessage.startThread({
        name: `Réponse de ${interaction.user.username}`,
        autoArchiveDuration: 1440
      });
    }
    
    // Stocker l'ID du message si réponse unique
    if (form.singleResponse && sentMessage) {
      client.forms[guildId][formId].respondents[interaction.user.id] = {
        timestamp: Date.now(),
        messageId: sentMessage.id
      };
      fs.writeJsonSync(client.formsPath, client.forms, { spaces: 2 });
    }
    
    await interaction.reply({
      content: '✅ Votre réponse a été envoyée avec succès !',
      ephemeral: true
    });
    
    console.log(`Réponse au formulaire "${form.title}" reçue de ${interaction.user.username}`);
  } catch (error) {
    console.error('Erreur lors de l\'envoi de la réponse:', error);
    await interaction.reply({
      content: '❌ Erreur lors de l\'envoi de votre réponse. Veuillez réessayer.',
      ephemeral: true
    });
  }
}

async function handleResponseDeletion(interaction, client) {
  const [, , formId, messageId] = interaction.customId.split('_');
  
  try {
    await interaction.deferReply({ ephemeral: true });
    
    // Vérifier les permissions
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      return await interaction.editReply({
        content: 'Vous n\'avez pas la permission de supprimer les réponses.',
        ephemeral: true
      });
    }

    const form = client.forms[interaction.guildId]?.[formId];
    if (!form) {
      return await interaction.editReply({
        content: 'Formulaire introuvable.',
        ephemeral: true
      });
    }

    try {
      // Supprimer le message
      const responseChannel = await client.channels.fetch(form.responseChannelId);
      const message = await responseChannel.messages.fetch(messageId);
      await message.delete();

      // Supprimer l'entrée du répondant si nécessaire
      if (form.respondents) {
        for (const [userId, info] of Object.entries(form.respondents)) {
          if (info.messageId === messageId) {
            delete form.respondents[userId];
            break;
          }
        }
        fs.writeJsonSync(client.formsPath, client.forms, { spaces: 2 });
      }

      await interaction.editReply({
        content: '✅ Réponse supprimée avec succès.',
        ephemeral: true
      });
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
      await interaction.editReply({
        content: '❌ Erreur lors de la suppression de la réponse.',
        ephemeral: true
      });
    }
  } catch (error) {
    console.error('Erreur générale lors de la suppression:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Une erreur est survenue.',
        ephemeral: true
      });
    }
  }
}

async function handleResponseReview(interaction, client) {
  const isAccept = interaction.customId.startsWith('accept_response_');
  const [, , formId, userId] = interaction.customId.split('_');
  
  const form = client.forms[interaction.guildId]?.[formId];
  if (!form || !form.reviewOptions?.enabled) {
    return await interaction.reply({
      content: 'Formulaire introuvable ou révision désactivée.',
      ephemeral: true
    });
  }

  // Vérifier les permissions
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
    return await interaction.reply({
      content: 'Vous n\'avez pas la permission de réviser les réponses.',
      ephemeral: true
    });
  }

  // Si messages personnalisés activés, afficher le modal
  if (form.reviewOptions.customMessagesEnabled) {
    const modal = new ModalBuilder()
      .setCustomId(`custom_message_${isAccept ? 'accept' : 'reject'}_${formId}_${interaction.message.id}_${userId}`)
      .setTitle(`Message personnalisé (${isAccept ? 'Acceptation' : 'Refus'})`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('custom_message_input')
            .setLabel('Message à envoyer à l\'utilisateur')
            .setPlaceholder(isAccept ? 
              (form.reviewOptions.acceptMessage || 'Votre réponse a été acceptée.') : 
              (form.reviewOptions.rejectMessage || 'Votre réponse a été refusée.')
            )
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
        )
      );

    await interaction.showModal(modal);
    return;
  }

  // Traitement direct sans modal
  await processReviewAction(interaction, client, formId, userId, isAccept);
}

async function handleCustomMessageModal(interaction, client) {
  const [, , action, formId, messageId, userId] = interaction.customId.split('_');
  const customMessage = interaction.fields.getTextInputValue('custom_message_input');
  const isAccept = action === 'accept';
  
  await interaction.deferReply({ ephemeral: true });
  
  try {
    // Traiter l'action avec le message personnalisé (ou null si vide)
    const finalMessage = customMessage && customMessage.trim() ? customMessage.trim() : null;
    await processReviewAction(interaction, client, formId, userId, isAccept, finalMessage, messageId);
    
    await interaction.editReply({
      content: `✅ Réponse ${isAccept ? 'acceptée' : 'refusée'} avec succès.`
    });
  } catch (error) {
    console.error('Erreur lors du traitement du message personnalisé:', error);
    await interaction.editReply({
      content: '❌ Erreur lors du traitement de votre action.'
    });
  }
}

async function processReviewAction(interaction, client, formId, userId, isAccept, customMessage = null, messageId = null) {
  const form = client.forms[interaction.guildId]?.[formId];
  if (!form) throw new Error('Formulaire introuvable');

  // Si pas de messageId fourni, l'obtenir depuis l'interaction
  const targetMessageId = messageId || interaction.message.id;

  try {
    // Mettre à jour le message de réponse
    const responseChannel = await client.channels.fetch(form.responseChannelId);
    const message = await responseChannel.messages.fetch(targetMessageId);
    
    const existingEmbed = message.embeds[0];
    const updatedEmbed = EmbedBuilder.from(existingEmbed)
      .setColor(isAccept ? 0x57F287 : 0xED4245)
      .setFooter({ text: isAccept ? '✅ Accepté' : '❌ Refusé' });

    // Toujours conserver le bouton de suppression après traitement
    const deleteButton = new ButtonBuilder()
      .setCustomId(`delete_response_${formId}_${targetMessageId}`)
      .setLabel('🗑️ Supprimer')
      .setStyle(ButtonStyle.Secondary);
    
    const row = new ActionRowBuilder().addComponents(deleteButton);
    const components = [row];

    // Message de statut si activé
    let statusMessage = '';
    if (form.reviewOptions.showStatusMessage !== false) {
      if (customMessage) {
        // Si un message personnalisé est fourni, l'afficher dans le statut
        statusMessage = `La réponse de <@${userId}> a été **${isAccept ? 'acceptée' : 'refusée'}** par ${interaction.user.toString()} pour : ${customMessage}`;
      } else {
        // Sinon, utiliser le message par défaut
        statusMessage = `La réponse de <@${userId}> a été **${isAccept ? 'acceptée' : 'refusée'}** par ${interaction.user.toString()}.`;
      }
    }

    await message.edit({
      content: statusMessage,
      embeds: [updatedEmbed],
      components: components
    });

    // Notifier l'utilisateur
    try {
      const targetUser = await client.users.fetch(userId);
      const notificationMessage = customMessage || 
        (isAccept ? 
          (form.reviewOptions.acceptMessage || 'Votre réponse a été acceptée.') :
          (form.reviewOptions.rejectMessage || 'Votre réponse a été refusée.')
        );
      
      await targetUser.send(notificationMessage);
      
      // Ajouter le rôle si spécifié
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (member) {
        const roleId = isAccept ? form.reviewOptions.acceptRoleId : form.reviewOptions.rejectRoleId;
        if (roleId) {
          try {
            await member.roles.add(roleId);
          } catch (err) {
            console.log(`Erreur lors de l'ajout du rôle ${roleId} à ${userId}:`, err.message);
          }
        }
      }
    } catch (userError) {
      console.log(`Impossible de notifier l'utilisateur ${userId}:`, userError.message);
    }

    // Log de l'action
    await logToWebhookAndConsole(
      isAccept ? "✅ Réponse acceptée" : "❌ Réponse refusée",
      `**${interaction.user.username}** a ${isAccept ? 'accepté' : 'refusé'} la réponse de **<@${userId}>** au formulaire "${form.title}"`,
      [
        { name: "Modérateur", value: `${interaction.user.username} (ID: ${interaction.user.id})`, inline: true },
        { name: "Action", value: isAccept ? "Acceptation" : "Refus", inline: true },
        { name: "Formulaire", value: form.title, inline: true },
        { name: "Serveur", value: interaction.guild.name, inline: false },
        { name: "Message", value: customMessage ? `"${customMessage}"` : "Message par défaut", inline: false },
        { name: "Lien", value: `[Voir la réponse](https://discord.com/channels/${interaction.guild.id}/${form.responseChannelId}/${targetMessageId})`, inline: false }
      ],
      isAccept ? 0x57F287 : 0xED4245
    );

    if (!customMessage && !messageId && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `✅ Réponse ${isAccept ? 'acceptée' : 'refusée'} avec succès.`,
        ephemeral: true
      });
    }

  } catch (error) {
    console.error(`Erreur lors du traitement de la ${isAccept ? 'acceptation' : 'refus'}:`, error);
    throw error;
  }
}

async function handleFormBuilder(interaction, client) {
  // Cette fonction est maintenant gérée dans formBuilder.js
  const { handleFormBuilder: formBuilderHandler } = require('./formBuilder.js');
  return await formBuilderHandler(interaction, client);
}

module.exports = {
  handleInteractions
};
