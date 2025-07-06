const { checkClartyBlacklist } = require('../../utils/clarty.js');
const { logToWebhookAndConsole } = require('../../utils/logger.js');
const { loadCooldowns, saveCooldowns, formatCooldownDuration } = require('../../utils/cooldowns.js');

async function handleFormSubmission(interaction, client) {
  const formId = interaction.customId.split('_')[2];
  const guildId = interaction.guild.id;
  
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
  const cooldownCheck = checkCooldown(guildId, formId, interaction.user.id, form.cooldownOptions);
  if (!cooldownCheck.allowed) {
    return await interaction.reply({
      content: `Vous devez attendre ${cooldownCheck.timeLeft} avant de pouvoir répondre à nouveau à ce formulaire.`,
      ephemeral: true
    });
  }

  // Vérifier les réponses uniques
  if (form.singleResponse && form.respondents && form.respondents[interaction.user.id]) {
    return await interaction.reply({
      content: 'Vous avez déjà répondu à ce formulaire.',
      ephemeral: true
    });
  }

  // Traiter la soumission du formulaire
  await processFormSubmission(interaction, client, form, guildId, formId);
}

function checkCooldown(guildId, formId, userId, cooldownOptions) {
  if (!cooldownOptions?.enabled) {
    return { allowed: true };
  }

  const cooldowns = loadCooldowns();
  const userCooldown = cooldowns[guildId]?.[formId]?.[userId];
  
  if (!userCooldown) {
    return { allowed: true };
  }

  const now = Date.now();
  const timeLeft = userCooldown - now;
  
  if (timeLeft <= 0) {
    return { allowed: true };
  }

  const minutesLeft = Math.ceil(timeLeft / (1000 * 60));
  return {
    allowed: false,
    timeLeft: formatCooldownDuration(minutesLeft)
  };
}

async function processFormSubmission(interaction, client, form, guildId, formId) {
  // Créer le modal avec les questions du formulaire
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
  
  const modal = new ModalBuilder()
    .setCustomId(`fill_modal_${formId}`)
    .setTitle(form.title.length > 45 ? form.title.substring(0, 42) + '...' : form.title);

  // Ajouter les questions (maximum 5 par modal Discord)
  const questions = form.questions.slice(0, 5);
  
  questions.forEach((question, index) => {
    const textInput = new TextInputBuilder()
      .setCustomId(`question_${index}`)
      .setLabel(question.text.length > 45 ? question.text.substring(0, 42) + '...' : question.text)
      .setStyle(question.style === 'PARAGRAPH' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(true);

    const actionRow = new ActionRowBuilder().addComponents(textInput);
    modal.addComponents(actionRow);
  });

  await interaction.showModal(modal);
}

module.exports = {
  handleFormSubmission
};
