const { getUsersEligibleForReminder, removeVoteTimestamp } = require('./vote-timestamps.js');
const { config } = require('./config.js');
const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

// Fonction pour créer l'embed de rappel de vote
function createVoteReminderEmbed() {
  return {
    color: 0x5865F2,
    title: '🗳️ Il est temps de voter !',
    description: 'Cela fait 12 heures depuis votre dernier vote ! Vous pouvez maintenant voter à nouveau.',
    fields: [
      {
        name: '🎁 Récompenses',
        value: '• **2 crédits IA** par vote\n• **3 crédits IA** le weekend',
        inline: false
      },
      {
        name: ' Astuce',
        value: 'Votez toutes les 12 heures pour maximiser vos crédits IA !',
        inline: false
      }
    ],
    footer: {
      text: 'Merci de soutenir MyForm ❤️'
    },
    timestamp: new Date().toISOString()
  };
}

// Fonction pour créer le bouton de vote
function createVoteButton() {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setLabel('🗳️ Voter sur Top.gg')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://top.gg/bot/${config.clientId}/vote`)
    );
}

// Fonction pour envoyer un rappel de vote à un utilisateur
async function sendVoteReminder(client, userId) {
  try {
    const user = await client.users.fetch(userId);
    if (!user) return false;
    
    const embed = createVoteReminderEmbed();
    const button = createVoteButton();
    
    await user.send({ embeds: [embed], components: [button] });
    console.log(`Rappel de vote envoyé à ${user.tag} (${userId})`);
    
    // Supprimer le timestamp après envoi du rappel
    removeVoteTimestamp(userId);
    
    return true;
  } catch (error) {
    console.log(`Impossible d'envoyer un rappel de vote à ${userId}:`, error.message);
    
    // Supprimer le timestamp même en cas d'erreur pour éviter les tentatives répétées
    removeVoteTimestamp(userId);
    
    return false;
  }
}

// Fonction pour vérifier et envoyer tous les rappels nécessaires
async function checkAndSendVoteReminders(client) {
  try {
    const eligibleUsers = getUsersEligibleForReminder();
    
    if (eligibleUsers.length === 0) {
      return;
    }
    
    console.log(`${eligibleUsers.length} utilisateur(s) éligible(s) pour un rappel de vote`);
    
    for (const userInfo of eligibleUsers) {
      await sendVoteReminder(client, userInfo.userId);
      
      // Attendre un peu entre chaque envoi pour éviter le rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`Rappels de vote traités: ${eligibleUsers.length} utilisateur(s)`);
    
  } catch (error) {
    console.error('Erreur lors de la vérification des rappels de vote:', error);
  }
}

// Fonction pour démarrer le système de rappels automatiques
function startVoteReminderSystem(client) {
  // Vérifier toutes les 10 minutes
  const reminderInterval = 10 * 60 * 1000; // 10 minutes
  
  console.log('Système de rappels de vote démarré (vérification toutes les 10 minutes)');
  
  setInterval(() => {
    checkAndSendVoteReminders(client);
  }, reminderInterval);
  
  // Première vérification après 1 minute
  setTimeout(() => {
    checkAndSendVoteReminders(client);
  }, 60000);
}

module.exports = {
  createVoteReminderEmbed,
  createVoteButton,
  sendVoteReminder,
  checkAndSendVoteReminders,
  startVoteReminderSystem
};
