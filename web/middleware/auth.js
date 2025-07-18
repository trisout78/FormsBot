const axios = require('axios');

const DISCORD_API_URL = 'https://discord.com/api/v10';

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
      
      // Gestion spécifique des rate limits Discord
      if (error.response && error.response.status === 429) {
        const retryAfter = error.response.data.retry_after || 1;
        throw {
          status: 429,
          data: {
            error: 'Rate limit atteint',
            message: 'You are being rate limited.',
            retry_after: retryAfter,
            global: error.response.data.global || false
          }
        };
      }
      
      return { data: [] };
    });

    // Vérifier si l'utilisateur est membre du serveur et récupérer ses permissions
    const userGuild = guildResponse.data.find(guild => guild.id === guildId);
    
    if (!userGuild) {
      return res.status(403).send('Vous n\'êtes pas membre de ce serveur');
    }
    
    // Vérifier les permissions (MANAGE_MESSAGES = 8192, ADMINISTRATOR = 8)
    const permissions = BigInt(userGuild.permissions || 0);
    const hasManageMessagesPermission = (permissions & BigInt(0x2000)) !== BigInt(0); // 0x2000 = MANAGE_MESSAGES
    
    // Autoriser l'accès si l'utilisateur a la permission de gérer les messages
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
      }
      
      // Ajouter les informations du serveur à la requête
      req.guild = userGuild;
      return next();
    }
    
    return res.status(403).send('Vous n\'avez pas les permissions nécessaires dans ce serveur');
  } catch (error) {
    console.log('Erreur lors de la vérification des permissions:', error);
    
    // Gestion spécifique des rate limits Discord
    if (error.status === 429) {
      return res.status(429).json(error.data);
    }
    
    res.status(500).send('Erreur lors de la vérification des permissions');
  }
}

module.exports = {
  isAuthenticated,
  hasGuildPermission,
  DISCORD_API_URL
};
