const express = require('express');
const http = require('http');
const path = require('path');
const { config, baseUrl } = require('../utils/config.js');

// Import des middlewares
const { setupMiddleware } = require('./middleware/index.js');

// Import des routes
const { setupRoutes } = require('./routes/index.js');

async function initializeWebServer(client) {
  const app = express();
  const server = http.createServer(app);

  // Configuration des middlewares
  setupMiddleware(app);

  // Configuration des routes
  setupRoutes(app, client);

  // Démarrage du serveur
  const PORT = process.env.PORT || config.webserver.port || 3000;
  
  return new Promise((resolve, reject) => {
    server.listen(PORT, (error) => {
      if (error) {
        reject(error);
      } else {
        console.log(`Serveur web démarré sur le port ${PORT}`);
        console.log(`URL: ${config.webserver.baseUrl}`);
        resolve(server);
      }
    });
  });
}

module.exports = {
  initializeWebServer
};
