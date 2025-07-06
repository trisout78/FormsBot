const OpenAI = require('openai');
const { config } = require('./config.js');

// Initialize OpenAI
const openai = new OpenAI({ apiKey: config.openai.apiKey });

// Rate limiting pour l'IA - 10 requêtes par heure par utilisateur
const aiRateLimit = new Map(); // userId -> { count, resetTime }

function checkAIRateLimit(userId) {
  const now = Date.now();
  const userLimit = aiRateLimit.get(userId);
  
  // Si pas d'entrée ou si l'heure est passée, reset
  if (!userLimit || now > userLimit.resetTime) {
    aiRateLimit.set(userId, {
      count: 1,
      resetTime: now + (60 * 60 * 1000) // 1 heure
    });
    return { allowed: true, remaining: 9, resetTime: now + (60 * 60 * 1000) };
  }
  
  // Si limite atteinte
  if (userLimit.count >= 10) {
    return { 
      allowed: false, 
      remaining: 0, 
      resetTime: userLimit.resetTime,
      timeLeft: Math.ceil((userLimit.resetTime - now) / (60 * 1000)) // minutes restantes
    };
  }
  
  // Incrémenter le compteur
  userLimit.count++;
  aiRateLimit.set(userId, userLimit);
  
  return { 
    allowed: true, 
    remaining: 10 - userLimit.count, 
    resetTime: userLimit.resetTime 
  };
}

// Nettoyer les anciennes entrées toutes les heures
setInterval(() => {
  const now = Date.now();
  for (const [userId, data] of aiRateLimit.entries()) {
    if (now > data.resetTime) {
      aiRateLimit.delete(userId);
    }
  }
}, 60 * 60 * 1000);

module.exports = {
  openai,
  checkAIRateLimit
};
