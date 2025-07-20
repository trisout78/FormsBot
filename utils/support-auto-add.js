const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { config } = require('./config.js');
const { logToWebhookAndConsole } = require('./logger.js');

// Chemin du fichier pour stocker les préférences des utilisateurs
const USER_PREFERENCES_PATH = path.join(__dirname, '../user-support-preferences.json');

// Structure des préférences utilisateur
let userPreferences = {};

// Charger les préférences des utilisateurs
function loadUserPreferences() {
  try {
    if (fs.existsSync(USER_PREFERENCES_PATH)) {
      userPreferences = fs.readJsonSync(USER_PREFERENCES_PATH);
    } else {
      userPreferences = {};
      saveUserPreferences();
    }
  } catch (error) {
    console.error('Erreur lors du chargement des préférences utilisateur:', error);
    userPreferences = {};
  }
}

// Sauvegarder les préférences des utilisateurs
function saveUserPreferences() {
  try {
    fs.writeJsonSync(USER_PREFERENCES_PATH, userPreferences, { spaces: 2 });
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des préférences utilisateur:', error);
  }
}

// Vérifier si un utilisateur veut être ajouté automatiquement au serveur de support
function shouldAutoAddToSupport(userId) {
  return userPreferences[userId]?.autoAddToSupport !== false; // Par défaut, true
}

// Définir les préférences d'un utilisateur
function setUserAutoAddPreference(userId, autoAdd = true) {
  if (!userPreferences[userId]) {
    userPreferences[userId] = {};
  }
  userPreferences[userId].autoAddToSupport = autoAdd;
  userPreferences[userId].lastUpdated = Date.now();
  saveUserPreferences();
}

// Marquer qu'un utilisateur a été ajouté au serveur de support
function markUserAddedToSupport(userId) {
  if (!userPreferences[userId]) {
    userPreferences[userId] = {};
  }
  userPreferences[userId].hasBeenAddedToSupport = true;
  userPreferences[userId].addedToSupportAt = Date.now();
  saveUserPreferences();
}

// Vérifier si un utilisateur a déjà été ajouté au serveur de support
function hasBeenAddedToSupport(userId) {
  return userPreferences[userId]?.hasBeenAddedToSupport === true;
}

// Ajouter un utilisateur au serveur de support Discord
async function addUserToSupportServer(client, userData, accessToken) {
  try {
    // Vérifier si l'utilisateur veut être ajouté automatiquement
    if (!shouldAutoAddToSupport(userData.id)) {
      console.log(`Utilisateur ${userData.username} ne veut pas être ajouté automatiquement au serveur de support`);
      return { success: false, reason: 'user_preference' };
    }

    // Vérifier si l'utilisateur a déjà été ajouté (ET vérifier qu'il est toujours membre)
    if (hasBeenAddedToSupport(userData.id)) {
      console.log(`Utilisateur ${userData.username} marqué comme déjà ajouté, vérification de son statut actuel...`);
      
      // Vérifier s'il est toujours membre du serveur
      try {
        const memberCheckUrl = `https://discord.com/api/v10/guilds/${config['staff-server']}/members/${userData.id}`;
        await axios.get(memberCheckUrl, {
          headers: {
            'Authorization': `Bot ${config.token}`
          }
        });
        
        // Il est toujours membre, pas besoin de l'ajouter à nouveau
        console.log(`Utilisateur ${userData.username} est toujours membre du serveur de support`);
        return { success: false, reason: 'already_added_and_member' };
      } catch (checkError) {
        if (checkError.response?.status === 404) {
          console.log(`Utilisateur ${userData.username} était marqué comme ajouté mais n'est plus membre, ré-ajout...`);
          // Il n'est plus membre, on continue le processus d'ajout
        } else {
          console.error('Erreur lors de la vérification du statut:', checkError.response?.data || checkError.message);
          return { success: false, reason: 'status_check_error' };
        }
      }
    }

    // Récupérer le serveur de support
    const supportServerId = config['staff-server']; // Utiliser le serveur staff comme serveur de support
    const supportGuild = client.guilds.cache.get(supportServerId);
    if (!supportGuild) {
      console.error('Serveur de support introuvable dans le cache du bot');
      return { success: false, reason: 'guild_not_found' };
    }

    // Vérifier que le bot a les permissions nécessaires
    const botMember = supportGuild.members.me;
    if (!botMember || !botMember.permissions.has('CreateInstantInvite')) {
      console.error('Le bot n\'a pas les permissions nécessaires pour ajouter des membres au serveur de support');
      return { success: false, reason: 'bot_insufficient_permissions' };
    }

    // Vérifier si l'utilisateur est déjà membre du serveur via l'API Discord
    try {
      const memberCheckUrl = `https://discord.com/api/v10/guilds/${supportServerId}/members/${userData.id}`;
      await axios.get(memberCheckUrl, {
        headers: {
          'Authorization': `Bot ${config.token}`
        }
      });
      
      // Si on arrive ici, l'utilisateur est déjà membre
      console.log(`Utilisateur ${userData.username} est déjà membre du serveur de support`);
      markUserAddedToSupport(userData.id);
      return { success: false, reason: 'already_member' };
    } catch (memberCheckError) {
      // Si l'erreur est 404 (Unknown Member), l'utilisateur n'est pas membre
      if (memberCheckError.response?.status === 404) {
        console.log(`Utilisateur ${userData.username} n'est pas encore membre du serveur de support, ajout en cours...`);
      } else {
        console.error('Erreur lors de la vérification du statut de membre:', memberCheckError.response?.data || memberCheckError.message);
        // En cas d'erreur autre que 404, on continue quand même l'ajout
      }
    }

    // Ajouter l'utilisateur au serveur avec l'API Discord
    const addMemberUrl = `https://discord.com/api/v10/guilds/${supportServerId}/members/${userData.id}`;
    
    console.log(`Tentative d'ajout au serveur ${supportServerId} pour l'utilisateur ${userData.id} (${userData.username})`);
    console.log(`URL d'ajout: ${addMemberUrl}`);
    
    try {
      const response = await axios.put(addMemberUrl, {
        access_token: accessToken
      }, {
        headers: {
          'Authorization': `Bot ${config.token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log(`Réponse de l'API Discord (status ${response.status}):`, response.data);
      console.log(`Utilisateur ${userData.username} ajouté avec succès au serveur de support`);
      
      // Marquer l'utilisateur comme ajouté
      markUserAddedToSupport(userData.id);

      // Log de l'ajout
      await logToWebhookAndConsole(
        "➕ Nouvel utilisateur ajouté au support",
        `**${userData.username}** a été automatiquement ajouté au serveur de support lors de sa connexion au panel web.`,
        [
          { name: "Utilisateur", value: `${userData.username} (ID: ${userData.id})`, inline: true },
          { name: "Date", value: new Date().toLocaleString(), inline: true },
          { name: "Source", value: "Connexion panel web", inline: true }
        ],
        0x00FF00
      );

      return { success: true, newMember: true };

    } catch (addError) {
      console.error('Erreur lors de l\'ajout de l\'utilisateur au serveur de support:', addError.response?.data || addError.message);
      
      // Gestion spécifique des différents codes d'erreur Discord
      if (addError.response?.status === 204) {
        // 204 = L'utilisateur était déjà membre
        markUserAddedToSupport(userData.id);
        return { success: false, reason: 'already_member' };
      } else if (addError.response?.data?.code === 40007) {
        // Code 40007 = L'utilisateur a été banni du serveur
        return { success: false, reason: 'user_banned' };
      } else if (addError.response?.data?.code === 50013) {
        // Code 50013 = Permissions insuffisantes
        return { success: false, reason: 'insufficient_permissions' };
      } else if (addError.response?.data?.code === 10004) {
        // Code 10004 = Serveur introuvable
        return { success: false, reason: 'guild_not_found' };
      } else if (addError.response?.data?.code === 50025) {
        // Code 50025 = Token invalide
        return { success: false, reason: 'invalid_token' };
      }

      return { success: false, reason: 'api_error', error: addError.response?.data || addError.message };
    }

  } catch (error) {
    console.error('Erreur générale lors de l\'ajout de l\'utilisateur au serveur de support:', error.message);
    return { success: false, reason: 'general_error', error: error.message };
  }
}

// Envoyer un message privé de bienvenue avec bouton de désinscription
async function sendWelcomeMessage(client, userData) {
  try {
    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    
    const user = await client.users.fetch(userData.id);
    
    const welcomeEmbed = new EmbedBuilder()
      .setTitle('🎉 Bienvenue sur MyForm Support !')
      .setDescription(`Salut **${userData.username}** !\n\nTu as été automatiquement ajouté(e) au serveur de support de MyForm lors de ta connexion au panel web. Cela te permettra de :\n\n• 🆘 Obtenir de l'aide rapidement\n• 📢 Être informé(e) des nouveautés\n• 💬 Échanger avec la communauté\n• 🐛 Signaler des bugs\n• 💡 Proposer des améliorations`)
      .setColor(0x3498db)
      .addFields(
        {
          name: '🔗 Serveur de support',
          value: `[${config.supportServer?.name || 'MyForm Support'}](${config.supportServer?.inviteUrl || 'https://discord.gg/xgGpGhSWq8'})`,
          inline: true
        },
        {
          name: '🌐 Panel web',
          value: `[Dashboard MyForm](${config.webserver.baseUrl}/dashboard)`,
          inline: true
        },
        {
          name: '📝 Note importante',
          value: 'Si tu préfères ne plus être ajouté(e) automatiquement au serveur de support lors de tes prochaines connexions, clique sur le bouton ci-dessous.',
          inline: false
        }
      )
      .setThumbnail(user.displayAvatarURL())
      .setFooter({ 
        text: 'MyForm • Support automatique', 
        iconURL: client.user.displayAvatarURL() 
      })
      .setTimestamp();

    const optOutButton = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`opt_out_support_${userData.id}`)
          .setLabel('Ne plus m\'ajouter automatiquement')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('❌')
      );

    await user.send({
      embeds: [welcomeEmbed],
      components: [optOutButton]
    });

    console.log(`Message de bienvenue envoyé à ${userData.username}`);
    return { success: true };

  } catch (error) {
    console.error(`Erreur lors de l'envoi du message de bienvenue à ${userData.username}:`, error.message);
    return { success: false, error: error.message };
  }
}

// Gérer l'opt-out des utilisateurs
async function handleOptOut(interaction) {
  try {
    const userId = interaction.customId.split('_')[3];
    
    // Vérifier que l'utilisateur peut modifier ses propres préférences
    if (interaction.user.id !== userId) {
      return await interaction.reply({
        content: '❌ Vous ne pouvez pas modifier les préférences d\'un autre utilisateur.',
        ephemeral: true
      });
    }

    // Mettre à jour les préférences
    setUserAutoAddPreference(userId, false);

    const { EmbedBuilder } = require('discord.js');
    
    const confirmEmbed = new EmbedBuilder()
      .setTitle('✅ Préférences mises à jour')
      .setDescription('Tu ne seras plus ajouté(e) automatiquement au serveur de support MyForm lors de tes prochaines connexions au panel web.\n\nTu peux toujours rejoindre manuellement le serveur de support si tu en as besoin !')
      .setColor(0x00FF00)
      .addFields({
        name: '🔗 Lien d\'invitation manuel',
        value: `[Rejoindre ${config.supportServer?.name || 'MyForm Support'}](${config.supportServer?.inviteUrl || 'https://discord.gg/xgGpGhSWq8'})`,
        inline: false
      })
      .setFooter({ 
        text: 'MyForm • Préférences de support', 
        iconURL: interaction.client.user.displayAvatarURL() 
      })
      .setTimestamp();

    await interaction.update({
      embeds: [confirmEmbed],
      components: [] // Retirer le bouton
    });

    // Log de l'opt-out
    await logToWebhookAndConsole(
      "❌ Utilisateur opt-out du support automatique",
      `**${interaction.user.username}** a choisi de ne plus être ajouté automatiquement au serveur de support.`,
      [
        { name: "Utilisateur", value: `${interaction.user.username} (ID: ${interaction.user.id})`, inline: true },
        { name: "Date", value: new Date().toLocaleString(), inline: true }
      ],
      0xFFA500
    );

    console.log(`Utilisateur ${interaction.user.username} a choisi de ne plus être ajouté automatiquement au support`);

  } catch (error) {
    console.error('Erreur lors du traitement de l\'opt-out:', error);
    
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Une erreur est survenue lors de la mise à jour de tes préférences.',
        ephemeral: true
      });
    }
  }
}

// Initialiser le module
loadUserPreferences();

module.exports = {
  addUserToSupportServer,
  sendWelcomeMessage,
  handleOptOut,
  shouldAutoAddToSupport,
  setUserAutoAddPreference,
  hasBeenAddedToSupport,
  markUserAddedToSupport,
  loadUserPreferences,
  saveUserPreferences
};
