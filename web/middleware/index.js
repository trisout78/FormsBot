const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const express = require('express');
const path = require('path');
const { config } = require('../../utils/config.js');

function setupMiddleware(app) {
  // Middlewares de base
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, '../../public')));
  
  // Configuration de session
  app.use(session({
    secret: config.secretKey,
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: config.webserver.baseUrl.startsWith('https'),
      maxAge: 24 * 60 * 60 * 1000 // 24 heures
    }
  }));

  // Middleware pour gérer les en-têtes de proxy
  app.set('trust proxy', true);
}

module.exports = {
  setupMiddleware
};
