const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');
const { config } = require('../../utils/config.js');
const { logToWebhookAndConsole } = require('../../utils/logger.js');
const { recordVoteTimestamp } = require('../../utils/vote-timestamps.js');

// Chemin vers le fichier de stockage des votes
const voteCreditsPath = path.join(__dirname, '../../vote.json');

// Vote credit system - chargé depuis le fichier
let voteCredits = new Map();

// Fonction pour charger les crédits de vote depuis le fichier
function loadVoteCredits() {
  try {
    if (fs.existsSync(voteCreditsPath)) {
      const data = fs.readJsonSync(voteCreditsPath);
      voteCredits.clear();
      
      // Convertir l'objet en Map
      if (data && typeof data === 'object') {
        Object.entries(data).forEach(([userId, credits]) => {
          voteCredits.set(userId, credits);
        });
      }
      
      console.log(`Crédits de vote chargés: ${voteCredits.size} utilisateurs`);
    } else {
      console.log('Fichier vote.json inexistant, création d\'une nouvelle base');
      saveVoteCredits();
    }
  } catch (error) {
    console.error('Erreur lors du chargement des crédits de vote:', error);
    voteCredits.clear();
  }
  return voteCredits;
}

// Fonction pour sauvegarder les crédits de vote dans le fichier
function saveVoteCredits() {
  try {
    // Convertir la Map en objet pour la sérialisation JSON
    const dataToSave = {};
    voteCredits.forEach((credits, userId) => {
      dataToSave[userId] = credits;
    });
    
    // Créer un backup si le fichier existe
    if (fs.existsSync(voteCreditsPath)) {
      const backupPath = path.join(__dirname, `../../vote_backup_${Date.now()}.json`);
      fs.copySync(voteCreditsPath, backupPath);
      
      // Nettoyer les anciens backups (garder seulement les 5 derniers)
      const backupFiles = fs.readdirSync(path.dirname(voteCreditsPath))
        .filter(f => f.startsWith('vote_backup_'))
        .sort()
        .reverse();
      
      if (backupFiles.length > 5) {
        backupFiles.slice(5).forEach(file => {
          fs.unlinkSync(path.join(path.dirname(voteCreditsPath), file));
        });
      }
    }
    
    fs.writeJsonSync(voteCreditsPath, dataToSave, { spaces: 2 });
    console.log(`Crédits de vote sauvegardés: ${Object.keys(dataToSave).length} utilisateurs`);
    return true;
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des crédits de vote:', error);
    return false;
  }
}

// Charger les crédits au démarrage
loadVoteCredits();

function setupWebhookRoutes(app, client) {
  // Middleware pour parser le JSON des webhooks
  app.use('/webhooks', bodyParser.json());

  // Top.gg webhook endpoint
  app.post('/webhooks/topgg', async (req, res) => {
    try {
      // Vérifier l'autorisation si configurée
      if (config.topgg?.authorization) {
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== config.topgg.authorization) {
          console.log('Webhook Top.gg rejeté: autorisation invalide');
          return res.status(401).json({ error: 'Unauthorized' });
        }
      }

      const vote = req.body;
      
      // Valider la structure des données
      if (!vote.bot || !vote.user || !vote.type) {
        console.log('Webhook Top.gg rejeté: données invalides', vote);
        return res.status(400).json({ error: 'Invalid data structure' });
      }

      // Vérifier que c'est bien notre bot
      if (vote.bot !== client.user.id) {
        console.log('Webhook Top.gg rejeté: bot ID incorrect', vote.bot);
        return res.status(400).json({ error: 'Invalid bot ID' });
      }

      // Traiter le vote
      await processTopGGVote(vote, client);
      
      // Répondre avec succès
      res.status(200).json({ success: true });
      
    } catch (error) {
      console.error('Erreur lors du traitement du webhook Top.gg:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Endpoint pour obtenir les crédits d'un utilisateur
  app.get('/api/user/:userId/vote-credits', async (req, res) => {
    try {
      const userId = req.params.userId;
      const userCredits = voteCredits.get(userId) || { credits: 0, lastVote: null };
      
      res.json({
        credits: userCredits.credits,
        lastVote: userCredits.lastVote
      });
    } catch (error) {
      console.error('Erreur lors de la récupération des crédits:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Endpoint pour obtenir le statut du webhook
  app.get('/api/webhook/status', async (req, res) => {
    try {
      res.json({
        webhookUrl: `${config.webserver.baseUrl}/webhooks/topgg`,
        hasAuthorization: !!config.topgg?.authorization,
        botId: client.user.id,
        allowedIP: '159.203.105.187'
      });
    } catch (error) {
      console.error('Erreur lors de la récupération du statut:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Endpoint de test pour simuler un vote (développement uniquement)
  if (process.env.NODE_ENV === 'development' || config.webhookUrl === '') {
    app.post('/webhooks/topgg/test', async (req, res) => {
      try {
        const testVote = {
          bot: client.user.id,
          user: req.body.user || '123456789012345678', // ID utilisateur de test
          type: 'test',
          isWeekend: req.body.isWeekend || false
        };

        await processTopGGVote(testVote, client);
        
        res.json({ 
          success: true, 
          message: 'Vote de test traité avec succès',
          testVote 
        });
      } catch (error) {
        console.error('Erreur lors du test webhook:', error);
        res.status(500).json({ error: 'Erreur lors du test' });
      }
    });
  }
}

async function processTopGGVote(vote, client) {
  try {
    const { user, type, isWeekend } = vote;
    
    // Ignorer les votes de test
    if (type === 'test') {
      console.log(`Vote de test reçu de ${user}`);
      return;
    }

    // Calculer les crédits à ajouter
    let creditsToAdd = 2; // 2 crédits de base
    
    // Bonus weekend (3 crédits au lieu de 2)
    if (isWeekend) {
      creditsToAdd = 3;
    }

    // Récupérer ou créer les crédits de l'utilisateur
    const userCredits = voteCredits.get(user) || { credits: 0, lastVote: null };
    
    // Ajouter les crédits
    userCredits.credits += creditsToAdd;
    userCredits.lastVote = Date.now();
    
    // Enregistrer le timestamp pour le système de rappels
    recordVoteTimestamp(user);
    
    // Sauvegarder
    voteCredits.set(user, userCredits);
    
    // Sauvegarder dans le fichier
    const saveSuccess = saveVoteCredits();
    if (!saveSuccess) {
      console.error('Erreur lors de la sauvegarde des crédits de vote');
    }

    // Log du vote
    await logToWebhookAndConsole(
      "🗳️ Vote Top.gg reçu",
      `<@${user}> a voté pour le bot sur Top.gg`,
      [
        { name: "Utilisateur", value: `<@${user}>`, inline: true },
        { name: "Type", value: type, inline: true },
        { name: "Weekend", value: isWeekend ? "Oui (x2)" : "Non", inline: true },
        { name: "Crédits ajoutés", value: `+${creditsToAdd}`, inline: true },
        { name: "Total crédits", value: `${userCredits.credits}`, inline: true },
        { name: "Date", value: new Date().toLocaleString(), inline: true }
      ],
      0x00D4AA
    );

    // Essayer d'envoyer un message de remerciement à l'utilisateur
    try {
      const userObj = await client.users.fetch(user);
      if (userObj) {
        const embed = {
          color: 0x00D4AA,
          title: '🗳️ Merci pour votre vote !',
          description: `Merci d'avoir voté pour **MyForm** sur Top.gg !`,
          fields: [
            {
              name: '🎁 Récompense',
              value: `Vous avez reçu **+${creditsToAdd} crédit${creditsToAdd > 1 ? 's' : ''} IA** !`,
              inline: false
            },
            {
              name: '💰 Total',
              value: `Vous avez maintenant **${userCredits.credits} crédit${userCredits.credits > 1 ? 's' : ''} IA**`,
              inline: true
            },
            {
              name: '⏰ Prochaine vote',
              value: 'Dans 12 heures',
              inline: true
            }
          ],
          footer: {
            text: 'Ces crédits sont globaux et utilisables sur tous les serveurs !'
          },
          timestamp: new Date().toISOString()
        };

        await userObj.send({ embeds: [embed] }).catch(() => {
          // L'utilisateur a probablement les DM désactivés
          console.log(`Impossible d'envoyer un message privé à ${user}`);
        });
      }
    } catch (error) {
      console.log(`Erreur lors de l'envoi du message de remerciement à ${user}:`, error.message);
    }

    console.log(`Vote traité pour ${user}: +${creditsToAdd} crédits (total: ${userCredits.credits})`);
    
  } catch (error) {
    console.error('Erreur lors du traitement du vote Top.gg:', error);
  }
}

// Fonction pour consommer des crédits
function consumeVoteCredits(userId, amount = 1) {
  const userCredits = voteCredits.get(userId);
  if (!userCredits || userCredits.credits < amount) {
    return false;
  }
  
  userCredits.credits -= amount;
  voteCredits.set(userId, userCredits);
  
  // Sauvegarder automatiquement après consommation
  saveVoteCredits();
  
  return true;
}

// Fonction pour obtenir les crédits d'un utilisateur
function getUserVoteCredits(userId) {
  const userCredits = voteCredits.get(userId) || { credits: 0, lastVote: null };
  return userCredits.credits;
}

// Nettoyer les anciennes données toutes les 24 heures
setInterval(() => {
  const now = Date.now();
  const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000); // 30 jours
  let hasChanges = false;
  
  for (const [userId, data] of voteCredits.entries()) {
    if (data.lastVote && data.lastVote < oneMonthAgo && data.credits === 0) {
      voteCredits.delete(userId);
      hasChanges = true;
    }
  }
  
  // Sauvegarder si des changements ont été effectués
  if (hasChanges) {
    saveVoteCredits();
    console.log('Nettoyage automatique des crédits de vote effectué');
  }
}, 24 * 60 * 60 * 1000);

module.exports = {
  setupWebhookRoutes,
  consumeVoteCredits,
  getUserVoteCredits,
  voteCredits,
  loadVoteCredits,
  saveVoteCredits
};
