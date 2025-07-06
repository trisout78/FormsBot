const bodyParser = require('body-parser');
const axios = require('axios');
const querystring = require('querystring');
const { config, baseUrl } = require('../../utils/config.js');
const { isAuthenticated, hasGuildPermission } = require('../middleware/auth.js');
const { logToWebhookAndConsole } = require('../../utils/logger.js');

// Base de données des transactions pour éviter les doublons
const processedTransactions = new Set();
const paymentAttempts = new Map();

function setupPaymentRoutes(app, client) {
  // API pour obtenir les informations de paiement
  app.get('/api/payment/info/:guildId', isAuthenticated, hasGuildPermission, (req, res) => {
    const { guildId } = req.params;
    const guild = client.guilds.cache.get(guildId);
    
    if (!guild) {
      return res.status(404).json({ error: 'Serveur introuvable' });
    }

    const isPremium = client.premiumGuilds.includes(guildId);
    
    if (isPremium) {
      return res.json({ error: 'Ce serveur est déjà premium' });
    }

    const paypalUrl = config.paypal.sandbox 
      ? 'https://www.sandbox.paypal.com/cgi-bin/webscr'
      : 'https://www.paypal.com/cgi-bin/webscr';

    res.json({
      guildName: guild.name,
      isPremium: false,
      paypalUrl: paypalUrl,
      paypalEmail: config.paypal.email,
      price: config.paypal.price,
      currency: config.paypal.currency,
      notifyUrl: `${baseUrl}/api/paypal/ipn`,
      returnUrl: `${baseUrl}/payment-success`,
      cancelUrl: `${baseUrl}/payment-cancel`
    });
  });

  // Middleware de sécurité pour IPN
  function ipnSecurityMiddleware(req, res, next) {
    const clientIP = req.ip || req.connection.remoteAddress;
    console.log(`[IPN_SECURITY] Request from IP: ${clientIP}`);

    const now = Date.now();
    const attempts = paymentAttempts.get(clientIP) || [];
    const recentAttempts = attempts.filter(time => now - time < 60000);
    
    if (recentAttempts.length >= 10) {
      console.log(`[IPN_SECURITY] Rate limit exceeded for IP: ${clientIP}`);
      return res.status(429).send('Trop de tentatives');
    }
    
    recentAttempts.push(now);
    paymentAttempts.set(clientIP, recentAttempts);
    next();
  }

  // Route IPN PayPal
  app.post('/api/paypal/ipn', 
    ipnSecurityMiddleware,
    bodyParser.raw({ type: '*/*' }),
    async (req, res) => {
      const clientIP = req.ip || req.connection.remoteAddress;
      console.log(`Notification IPN PayPal reçue depuis ${clientIP}`);
      
      try {
        let raw = req.body.toString('utf8');
        let formData = querystring.parse(raw);
        
        // Vérification des champs requis
        const requiredFields = ['txn_id', 'payment_status', 'custom'];
        const missingFields = requiredFields.filter(field => !formData[field]);
        
        if (missingFields.length > 0) {
          console.log('[IPN_ERROR] Données IPN incomplètes:', missingFields);
          return res.status(400).send('Données incomplètes');
        }
        
        const transactionId = formData.txn_id;
        if (processedTransactions.has(transactionId)) {
          console.log(`Transaction ${transactionId} déjà traitée`);
          return res.status(200).send('Déjà traité');
        }
        
        // Validation IPN
        const verificationUrl = config.paypal.sandbox 
          ? 'https://ipnpb.sandbox.paypal.com/cgi-bin/webscr'
          : 'https://ipnpb.paypal.com/cgi-bin/webscr';
        
        const verificationData = 'cmd=_notify-validate&' + querystring.stringify(formData);
        
        const verification = await axios.post(verificationUrl, verificationData, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'FormsBot-IPN-Verification/1.0'
          },
          timeout: 10000
        });
        
        if (verification.data !== 'VERIFIED') {
          console.log('IPN non vérifié par PayPal');
          return res.status(400).send('IPN non vérifié');
        }
        
        console.log('IPN vérifié par PayPal avec succès');
        
        if (formData.payment_status === 'Completed') {
          const success = await processSuccessfulPayment(formData, clientIP, client);
          if (success) {
            processedTransactions.add(transactionId);
          }
        }
        
        res.status(200).send('OK');
      } catch (error) {
        console.error('Erreur lors du traitement de l\'IPN:', error);
        res.status(500).send('Erreur serveur');
      }
    }
  );

  // Routes de test IPN
  app.post('/api/paypal/ipn-test', (req, res) => {
    console.log('=== TEST IPN ===');
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    res.status(200).send('TEST OK');
  });
}

async function processSuccessfulPayment(formData, clientIP, client) {
  try {
    const custom = formData.custom;
    const guildId = custom.startsWith('guild_') ? custom.split('_')[1] : custom;
    
    if (!client.premiumGuilds.includes(guildId)) {
      client.premiumGuilds.push(guildId);
      // Sauvegarder la liste premium
      await logToWebhookAndConsole(
        '🟢 Premium activé',
        `Serveur **${guildId}** activé en premium via IPN (${clientIP})`,
        [],
        0x57F287
      );
    }
    return true;
  } catch (e) {
    console.error('Erreur in processSuccessfulPayment:', e);
    return false;
  }
}

module.exports = setupPaymentRoutes;
