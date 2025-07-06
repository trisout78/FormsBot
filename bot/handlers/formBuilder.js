const { 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder 
} = require('discord.js');
const fs = require('fs-extra');

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

async function updateWizard(builder, client) {
  try {
    const { embeds, components } = buildWizard(builder);
    const channel = await client.channels.fetch(builder.wizardChannelId);
    const message = await channel.messages.fetch(builder.messageId);
    await message.edit({ embeds, components });
    console.log(`Wizard mis à jour pour ${builder.userId}, message: ${builder.messageId}`);
    return true;
  } catch (error) {
    console.log('Erreur lors de la mise à jour du wizard:', error.message);
    if (error.code === 10008) {
      console.log(`Message wizard introuvable, suppression du builder pour l'utilisateur ${builder.userId}`);
      client.formBuilders.delete(builder.userId);
    }
    return false;
  }
}

async function handleFormBuilder(interaction, client) {
  const userId = interaction.user.id;
  
  if (interaction.isButton()) {
    const builder = client.formBuilders.get(userId);
    if (!builder) {
      return await interaction.reply({
        content: 'Session de création expirée. Utilisez `/createform` pour recommencer.',
        ephemeral: true
      });
    }

    switch (interaction.customId) {
      case 'add_question':
        const questionModal = new ModalBuilder()
          .setCustomId('question_modal')
          .setTitle('Ajouter une question')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('question_text')
                .setLabel('Texte de la question')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('question_style')
                .setLabel('Style (SHORT ou PARAGRAPH)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue('SHORT')
                .setMaxLength(10)
            )
          );
        await interaction.showModal(questionModal);
        break;

      case 'remove_question':
        if (builder.questions.length === 0) {
          return await interaction.reply({
            content: 'Aucune question à supprimer.',
            ephemeral: true
          });
        }
        
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('remove_question_select')
          .setPlaceholder('Choisir une question à supprimer')
          .addOptions(
            builder.questions.map((q, i) => ({
              label: `${i + 1}. ${q.text.length > 50 ? q.text.substring(0, 47) + '...' : q.text}`,
              value: i.toString(),
              description: q.style === 'SHORT' ? 'Réponse courte' : 'Réponse longue'
            }))
          );
          
        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.reply({
          content: 'Sélectionnez une question à supprimer:',
          components: [row],
          ephemeral: true
        });
        break;

      case 'set_title':
        const titleModal = new ModalBuilder()
          .setCustomId('title_modal')
          .setTitle('Définir le titre')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('form_title')
                .setLabel('Titre du formulaire')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100)
                .setValue(builder.title || '')
            )
          );
        await interaction.showModal(titleModal);
        break;

      case 'choose_embed_channel':
        const embedChannelSelect = new ChannelSelectMenuBuilder()
          .setCustomId('embed_channel_select')
          .setPlaceholder('Choisir le salon pour l\'embed')
          .setChannelTypes([0]); // Text channels only
          
        const embedRow = new ActionRowBuilder().addComponents(embedChannelSelect);
        await interaction.reply({
          content: 'Sélectionnez le salon où l\'embed du formulaire sera envoyé:',
          components: [embedRow],
          ephemeral: true
        });
        break;

      case 'choose_response_channel':
        const responseChannelSelect = new ChannelSelectMenuBuilder()
          .setCustomId('response_channel_select')
          .setPlaceholder('Choisir le salon pour les réponses')
          .setChannelTypes([0]); // Text channels only
          
        const responseRow = new ActionRowBuilder().addComponents(responseChannelSelect);
        await interaction.reply({
          content: 'Sélectionnez le salon où les réponses seront envoyées:',
          components: [responseRow],
          ephemeral: true
        });
        break;

      case 'set_embed_text':
        const embedTextModal = new ModalBuilder()
          .setCustomId('embed_text_modal')
          .setTitle('Définir le texte embed')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('embed_text')
                .setLabel('Texte de présentation du formulaire')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(1000)
                .setValue(builder.embedText || '')
            )
          );
        await interaction.showModal(embedTextModal);
        break;

      case 'set_button_label':
        const buttonLabelModal = new ModalBuilder()
          .setCustomId('button_label_modal')
          .setTitle('Définir le label du bouton')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('button_label')
                .setLabel('Texte du bouton (ex: "Répondre", "Postuler")')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(80)
                .setValue(builder.buttonLabel || '')
            )
          );
        await interaction.showModal(buttonLabelModal);
        break;

      case 'finish_form':
        return await finishFormCreation(interaction, client, builder);

      default:
        await interaction.reply({
          content: 'Action non reconnue.',
          ephemeral: true
        });
    }
  }

  if (interaction.isModalSubmit()) {
    const builder = client.formBuilders.get(userId);
    if (!builder) {
      return await interaction.reply({
        content: 'Session de création expirée.',
        ephemeral: true
      });
    }

    switch (interaction.customId) {
      case 'question_modal':
        const questionText = interaction.fields.getTextInputValue('question_text');
        const questionStyle = interaction.fields.getTextInputValue('question_style').toUpperCase();
        
        if (!['SHORT', 'PARAGRAPH'].includes(questionStyle)) {
          return await interaction.reply({
            content: 'Style invalide. Utilisez "SHORT" ou "PARAGRAPH".',
            ephemeral: true
          });
        }
        
        builder.questions.push({
          text: questionText,
          style: questionStyle
        });
        
        client.formBuilders.set(userId, builder);
        await updateWizard(builder, client);
        
        await interaction.reply({
          content: `✅ Question ajoutée: "${questionText}"`,
          ephemeral: true
        });
        break;

      case 'title_modal':
        const title = interaction.fields.getTextInputValue('form_title');
        builder.title = title;
        
        client.formBuilders.set(userId, builder);
        await updateWizard(builder, client);
        
        await interaction.reply({
          content: `✅ Titre défini: "${title}"`,
          ephemeral: true
        });
        break;

      case 'embed_text_modal':
        const embedText = interaction.fields.getTextInputValue('embed_text');
        builder.embedText = embedText;
        
        client.formBuilders.set(userId, builder);
        await updateWizard(builder, client);
        
        await interaction.reply({
          content: `✅ Texte embed défini.`,
          ephemeral: true
        });
        break;

      case 'button_label_modal':
        const buttonLabel = interaction.fields.getTextInputValue('button_label');
        builder.buttonLabel = buttonLabel;
        
        client.formBuilders.set(userId, builder);
        await updateWizard(builder, client);
        
        await interaction.reply({
          content: `✅ Label du bouton défini: "${buttonLabel}"`,
          ephemeral: true
        });
        break;
    }
  }

  if (interaction.isStringSelectMenu()) {
    const builder = client.formBuilders.get(userId);
    if (!builder) {
      return await interaction.reply({
        content: 'Session de création expirée.',
        ephemeral: true
      });
    }

    if (interaction.customId === 'remove_question_select') {
      const questionIndex = parseInt(interaction.values[0]);
      const removedQuestion = builder.questions.splice(questionIndex, 1)[0];
      
      client.formBuilders.set(userId, builder);
      await updateWizard(builder, client);
      
      await interaction.reply({
        content: `✅ Question supprimée: "${removedQuestion.text}"`,
        ephemeral: true
      });
    }
  }

  if (interaction.isChannelSelectMenu()) {
    const builder = client.formBuilders.get(userId);
    if (!builder) {
      return await interaction.reply({
        content: 'Session de création expirée.',
        ephemeral: true
      });
    }

    const selectedChannel = interaction.values[0];
    
    if (interaction.customId === 'embed_channel_select') {
      builder.embedChannelId = selectedChannel;
      
      client.formBuilders.set(userId, builder);
      await updateWizard(builder, client);
      
      await interaction.reply({
        content: `✅ Salon embed défini: <#${selectedChannel}>`,
        ephemeral: true
      });
    } else if (interaction.customId === 'response_channel_select') {
      builder.responseChannelId = selectedChannel;
      
      client.formBuilders.set(userId, builder);
      await updateWizard(builder, client);
      
      await interaction.reply({
        content: `✅ Salon réponses défini: <#${selectedChannel}>`,
        ephemeral: true
      });
    }
  }
}

async function finishFormCreation(interaction, client, builder) {
  // Validation
  if (!builder.title) {
    return await interaction.reply({
      content: '❌ Vous devez définir un titre pour le formulaire.',
      ephemeral: true
    });
  }
  
  if (builder.questions.length === 0) {
    return await interaction.reply({
      content: '❌ Vous devez ajouter au moins une question.',
      ephemeral: true
    });
  }
  
  if (!builder.embedChannelId) {
    return await interaction.reply({
      content: '❌ Vous devez choisir un salon pour l\'embed.',
      ephemeral: true
    });
  }
  
  if (!builder.responseChannelId) {
    return await interaction.reply({
      content: '❌ Vous devez choisir un salon pour les réponses.',
      ephemeral: true
    });
  }
  
  if (!builder.embedText) {
    return await interaction.reply({
      content: '❌ Vous devez définir le texte de présentation.',
      ephemeral: true
    });
  }
  
  if (!builder.buttonLabel) {
    return await interaction.reply({
      content: '❌ Vous devez définir le label du bouton.',
      ephemeral: true
    });
  }

  try {
    await interaction.deferReply({ ephemeral: true });

    // Créer le formulaire
    const formId = Date.now().toString();
    const guildId = interaction.guild.id;
    
    const form = {
      title: builder.title,
      questions: builder.questions,
      embedChannelId: builder.embedChannelId,
      responseChannelId: builder.responseChannelId,
      embedText: builder.embedText,
      buttonLabel: builder.buttonLabel,
      singleResponse: false,
      createThreads: false,
      clartyProtection: false,
      cooldownOptions: {
        enabled: false,
        duration: 60
      },
      reviewOptions: {
        enabled: false,
        customMessagesEnabled: false,
        showStatusMessage: true,
        acceptMessage: "",
        rejectMessage: "",
        acceptRoleId: "",
        rejectRoleId: ""
      },
      embedMessageId: "",
      respondents: {}
    };

    // Sauvegarder dans les données
    if (!client.forms[guildId]) {
      client.forms[guildId] = {};
    }
    client.forms[guildId][formId] = form;
    
    await fs.writeJson(client.formsPath, client.forms, { spaces: 2 });

    // Créer l'embed et l'envoyer
    const embed = new EmbedBuilder()
      .setTitle(form.title)
      .setDescription(form.embedText)
      .setColor(0x3498db)
      .setFooter({ text: `Formulaire ID: ${formId}` });

    const button = new ButtonBuilder()
      .setCustomId(`fill_${formId}`)
      .setLabel(form.buttonLabel)
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    const embedChannel = await client.channels.fetch(form.embedChannelId);
    const embedMessage = await embedChannel.send({
      embeds: [embed],
      components: [row]
    });

    // Sauvegarder l'ID du message
    client.forms[guildId][formId].embedMessageId = embedMessage.id;
    await fs.writeJson(client.formsPath, client.forms, { spaces: 2 });

    // Nettoyer le builder
    client.formBuilders.delete(builder.userId);

    await interaction.editReply({
      content: `✅ Formulaire "${form.title}" créé avec succès!\n📤 Embed envoyé dans <#${form.embedChannelId}>\n📥 Réponses dans <#${form.responseChannelId}>`
    });

    console.log(`Formulaire ${formId} créé par ${interaction.user.username} sur le serveur ${interaction.guild.name}`);

  } catch (error) {
    console.error('Erreur lors de la création du formulaire:', error);
    await interaction.editReply({
      content: '❌ Erreur lors de la création du formulaire. Veuillez réessayer.'
    });
  }
}

module.exports = {
  handleFormBuilder,
  buildWizard,
  updateWizard
};
