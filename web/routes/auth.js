const axios = require('axios');
const { config, baseUrl } = require('../../utils/config.js');
const { checkClartyBlacklist } = require('../../utils/clarty.js');
const { logToWebhookAndConsole } = require('../../utils/logger.js');
const { isAuthenticated, DISCORD_API_URL } = require('../middleware/auth.js');

const OAUTH_REDIRECT_URI = `${config.webserver.baseUrl}/auth/discord/callback`;
const OAUTH_SCOPES = ['identify', 'guilds', 'guilds.members.read'];

function setupAuthRoutes(app, client) {
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

  // Callback OAuth2 Discord
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

      const userData = userResponse.data;

      // Vérifier la blacklist Clarty OpenBL
      const blacklistCheck = await checkClartyBlacklist(userData.id);
      
      if (blacklistCheck.isBlacklisted) {
        const reason = blacklistCheck.userData?.blacklisted_reasons?.fr_fr || 
                      blacklistCheck.userData?.blacklisted_reasons?.en_gb || 
                      'Raison non spécifiée';
        
        await logToWebhookAndConsole(
          "🚫 Tentative de connexion blacklistée",
          `**${userData.username}** (blacklisté) a tenté de se connecter au panel web.`,
          [
            { name: "Utilisateur", value: `${userData.username} (ID: ${userData.id})`, inline: true },
            { name: "Raison blacklist", value: reason, inline: false },
            { name: "Date", value: new Date().toLocaleString(), inline: true },
            { name: "Action", value: "Connexion refusée", inline: true }
          ],
          0xED4245
        );

        const encodedReason = encodeURIComponent(reason);
        return res.redirect(`/blacklisted?reason=${encodedReason}`);
      }

      // Sauvegarder les informations de session
      req.session.accessToken = access_token;
      req.session.refreshToken = refresh_token;
      req.session.expiresAt = Date.now() + expires_in * 1000;
      req.session.user = userData;
      
      // Log de connexion
      const logFields = [
        { name: "Utilisateur", value: `${userData.username} (ID: ${userData.id})`, inline: true },
        { name: "Date", value: new Date().toLocaleString(), inline: true }
      ];

      if (blacklistCheck.error) {
        logFields.push({ 
          name: "Note Clarty", 
          value: "Erreur lors de la vérification, connexion autorisée par défaut", 
          inline: false 
        });
      } else {
        logFields.push({ 
          name: "Statut Clarty", 
          value: "Utilisateur vérifié, non blacklisté", 
          inline: true 
        });
      }

      await logToWebhookAndConsole(
        "👤 Connexion au panel web", 
        `**${userData.username}** s'est connecté au panel web.`,
        logFields,
        0x5865F2
      );

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
}

module.exports = setupAuthRoutes;
