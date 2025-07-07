const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const fs = require('fs-extra');
const path = require('path');
const { config } = require('../utils/config.js');
const { loadBlacklist, saveBlacklist, isUserBlacklisted } = require('../utils/blacklist.js');
const { checkClartyBlacklist } = require('../utils/clarty.js');
const { logToWebhookAndConsole } = require('../utils/logger.js');
const { premiumGuilds, loadPremiumList } = require('../utils/premium.js');

// Import des handlers
const { handleInteractions } = require('./handlers/interactions.js');

// Configuration REST pour les commandes
const rest = new REST({ version: '9' }).setToken(config.token);

let client;

async function initializeBot() {
  // Configuration du client Discord
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  // Initialisation des collections
  client.commands = new Collection();
  client.formBuilders = new Map();
  client.tempResponses = new Map();
  
  // Charger et assigner la liste premium
  loadPremiumList();
  client.premiumGuilds = premiumGuilds;

  // Chemins des fichiers de données
  client.formsPath = path.join(__dirname, '../forms.json');
  client.cooldownPath = path.join(__dirname, '../cooldown.json');

  // Charger les formulaires
  try {
    if (fs.existsSync(client.formsPath)) {
      client.forms = fs.readJsonSync(client.formsPath);
      console.log(`Formulaires chargés: ${Object.keys(client.forms).length} serveurs avec formulaires`);
    } else {
      client.forms = {};
      fs.writeJsonSync(client.formsPath, {}, { spaces: 2 });
      console.log('Fichier de formulaires créé');
    }
  } catch (error) {
    console.error('Erreur lors du chargement des formulaires:', error);
    client.forms = {};
  }

  // Attacher les fonctions de blacklist au client
  client.loadBlacklist = loadBlacklist;
  client.saveBlacklist = saveBlacklist;
  client.isUserBlacklisted = isUserBlacklisted;

  // Charger la blacklist
  loadBlacklist();

  // Charger les commandes
  loadCommands();

  // Configuration des statuts rotatifs
  setupStatusRotation();

  // Événements du bot
  setupEventHandlers();

  // Connexion du bot
  await client.login(config.token);

  return client;
}

function loadCommands() {
  const commandsPath = path.join(__dirname, '../commands');
  
  if (!fs.existsSync(commandsPath)) {
    console.log('Dossier commands non trouvé, création...');
    fs.ensureDirSync(commandsPath);
    return;
  }
  
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
  
  for (const file of commandFiles) {
    try {
      const command = require(path.join(commandsPath, file));
      if (!command || !command.data || !command.data.name) {
        console.log(`Skipping invalid command file: ${file}`);
        continue;
      }
      client.commands.set(command.data.name, command);
    } catch (error) {
      console.error(`Erreur lors du chargement de la commande ${file}:`, error);
    }
  }
  
  console.log(`Loaded ${client.commands.size} commands`);
}

// Fonction pour enregistrer les commandes dans une guilde
async function registerGuildCommands(guildId) {
  try {
    const commandsData = [...client.commands.values()].map(cmd => cmd.data.toJSON());
    await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body: commandsData });
    console.log(`Commandes enregistrées pour le serveur ${guildId}`);
  } catch (error) {
    console.error(`Erreur lors de l'enregistrement des commandes pour ${guildId}:`, error);
  }
}

function setupStatusRotation() {
  const botStatuses = [
    { type: 'Playing', name: '📝 Créer des formulaires' },
    { type: 'Watching', name: '📊 Les réponses arriver' },
    { type: 'Listening', name: '💬 Vos commandes' },
    { type: 'Watching', name: '⚙️ Les configurations' },
    { type: 'Playing', name: '🤖 Assistant IA intégré' },
    { type: 'Playing', name: '💎 Premium disponible' },
    { type: 'Playing', name: '🆕 1.5 disponible' }
  ];

  let currentStatusIndex = 0;

  function updateBotStatus() {
    if (!client.user) return;
    
    const status = botStatuses[currentStatusIndex];
    const activityType = status.type === 'Playing' ? 0 : 
                        status.type === 'Streaming' ? 1 : 
                        status.type === 'Listening' ? 2 : 
                        status.type === 'Watching' ? 3 : 0;
    
    client.user.setPresence({
      activities: [{
        name: status.name,
        type: activityType
      }],
      status: 'online'
    });
    
    currentStatusIndex = (currentStatusIndex + 1) % botStatuses.length;
  }

  // Mettre à jour le statut toutes les 30 secondes
  setInterval(updateBotStatus, 30000);
  
  // Mettre à jour immédiatement quand le bot est prêt
  client.once(Events.ClientReady, () => {
    updateBotStatus();
  });
}

function setupEventHandlers() {
  client.once(Events.ClientReady, async () => {
    console.log(`Bot connecté en tant que ${client.user.tag}`);
    console.log(`Présent sur ${client.guilds.cache.size} serveurs`);
    
    // Enregistrer les commandes pour tous les serveurs
    for (const guild of client.guilds.cache.values()) {
      await registerGuildCommands(guild.id);
    }
    
    console.log('Commandes enregistrées pour tous les serveurs');
    
    // Log de démarrage
    await logToWebhookAndConsole(
      "🚀 Bot démarré",
      `**${client.user.tag}** est maintenant en ligne`,
      [
        { name: "Serveurs", value: client.guilds.cache.size.toString(), inline: true },
        { name: "Utilisateurs", value: client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0).toString(), inline: true },
        { name: "Version", value: "1.5", inline: true }
      ],
      0x00FF00
    );
  });

  // Enregistrer les commandes quand le bot rejoint un nouveau serveur
  client.on('guildCreate', async (guild) => {
    console.log(`Bot ajouté au serveur: ${guild.name} (${guild.id})`);
    await registerGuildCommands(guild.id);
    
    await logToWebhookAndConsole(
      "➕ Nouveau serveur",
      `Le bot a été ajouté au serveur **${guild.name}**`,
      [
        { name: "Serveur", value: guild.name, inline: true },
        { name: "ID", value: guild.id, inline: true },
        { name: "Membres", value: guild.memberCount.toString(), inline: true }
      ],
      0x3498DB
    );
  });

  // Log quand le bot quitte un serveur
  client.on('guildDelete', async (guild) => {
    console.log(`Bot retiré du serveur: ${guild.name} (${guild.id})`);
    
    await logToWebhookAndConsole(
      "➖ Serveur quitté",
      `Le bot a été retiré du serveur **${guild.name}**`,
      [
        { name: "Serveur", value: guild.name, inline: true },
        { name: "ID", value: guild.id, inline: true }
      ],
      0xE74C3C
    );
  });

  // Gestionnaire d'interactions
  client.on(Events.InteractionCreate, async (interaction) => {
    await handleInteractions(interaction, client);
  });

  // Log quand le bot s'arrête
  process.on('SIGINT', async () => {
    console.log('Arrêt du bot...');
    await logToWebhookAndConsole(
      "🛑 Bot arrêté",
      `**${client.user?.tag || 'FormsBot'}** s'arrête`,
      [],
      0xFF0000
    );
    await client.destroy();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Arrêt du bot...');
    await logToWebhookAndConsole(
      "🛑 Bot arrêté",
      `**${client.user?.tag || 'FormsBot'}** s'arrête`,
      [],
      0xFF0000
    );
    await client.destroy();
    process.exit(0);
  });
}

module.exports = {
  initializeBot,
  getClient: () => client
};
