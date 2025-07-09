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

async function generateReviewResponse(isAccept, formTitle, reason = null, instructions = null, feedback = null) {
  try {
    const action = isAccept ? 'acceptation' : 'refus';
    const actionPast = isAccept ? 'acceptée' : 'refusée';
    
    let prompt = `Tu es un assistant IA qui aide à rédiger des messages ${isAccept ? 'd\'acceptation' : 'de refus'} pour des formulaires Discord de manière professionnelle et bienveillante.

Contexte:
- Formulaire: "${formTitle}"
- Action: ${action}
- Ton: ${isAccept ? 'Positif et encourageant' : 'Respectueux et constructif'}`;

    if (reason) {
      prompt += `\n- Motif spécifique: ${reason}`;
    }
    
    if (instructions) {
      prompt += `\n- Instructions particulières: ${instructions}`;
    }
    
    if (feedback) {
      prompt += `\n- Retour à incorporer: ${feedback}`;
    }

    prompt += `\n\nRédige un message ${isAccept ? 'd\'acceptation' : 'de refus'} professionnel et bienveillant. Le message doit être:
- Clair et direct
- ${isAccept ? 'Féliciter l\'utilisateur' : 'Respectueux malgré le refus'}
- Personnalisé selon le contexte fourni
- En français
- Entre 50 et 200 mots
- Sans utiliser de markdown (pas de **gras** ou *italique*)

${isAccept ? 'Commence par féliciter l\'utilisateur pour son acceptation.' : 'Commence par remercier l\'utilisateur pour sa réponse.'}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: 'Tu es un assistant IA spécialisé dans la rédaction de messages professionnels et bienveillants pour des formulaires Discord. Tu dois toujours répondre en français et de manière appropriée au contexte.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 300,
      temperature: 0.7
    });

    const response = completion.choices[0].message.content.trim();
    
    // Nettoyer la réponse de tout markdown résiduel
    const cleanResponse = response
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/_(.*?)_/g, '$1');

    return {
      success: true,
      message: cleanResponse
    };
  } catch (error) {
    console.error('Erreur lors de la génération de la réponse IA:', error);
    return {
      success: false,
      error: 'Erreur lors de la génération de la réponse IA'
    };
  }
}

module.exports = {
  openai,
  checkAIRateLimit,
  generateReviewResponse
};
