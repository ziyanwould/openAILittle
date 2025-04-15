// modelRateLimits.js
module.exports = {
    'gpt-4o-mini': {
      limits: [
        { windowMs: 2 * 60 * 1000, max: 20 },
        { windowMs: 30 * 60 * 1000, max: 100 },
        { windowMs: 3 * 60 * 60 * 1000, max: 500 },
      ],
      dailyLimit: 5000, // 例如，gpt-4-turbo 每天总限制 500 次
    },
    'cogvideox-flash': {
      limits: [
        { windowMs: 2 * 60 * 1000, max: 5 },
        { windowMs: 3 * 60 * 60 * 1000, max: 20 },
      ],
      dailyLimit: 50, // 例如，gpt-4-turbo 每天总限制 500 次
    },
    'cogview-3-flash': {
      limits: [
        { windowMs: 2 * 60 * 1000, max: 5 },
        { windowMs: 3 * 60 * 60 * 1000, max: 20 },
      ],
      dailyLimit: 50, // 例如，gpt-4-turbo 每天总限制 500 次
    },
      'o1-mini': {
      limits: [
        { windowMs: 2 * 60 * 1000, max: 2 },
        { windowMs: 3 * 60 * 60 * 1000, max: 20 },
      ],
      dailyLimit: 50, // 例如，gpt-4-turbo 每天总限制 500 次
    },
    'o1-preview': {
      limits: [
        { windowMs: 2 * 60 * 1000, max: 2 },
        { windowMs: 3 * 60 * 60 * 1000, max: 20 },
      ],
      dailyLimit: 50, // 例如，gpt-4-turbo 每天总限制 500 次
    },
    'gpt-4-turbo': {
      limits: [
        { windowMs: 2 * 60 * 1000, max: 10 },
        { windowMs: 3 * 60 * 60 * 1000, max: 30 },
      ],
      dailyLimit: 300, // 例如，gpt-4-turbo 每天总限制 500 次
    },
    'gpt-4o': {
      limits: [
        { windowMs: 2 * 60 * 1000, max: 10 },
        { windowMs: 3 * 60 * 60 * 1000, max: 50 }, // 每分钟 1 次
      ],
      dailyLimit: 300, // 例如，gpt-4o 每天总限制 300 次
    },
    'claude-3-haiku-20240307': {
      limits: [
        { windowMs: 5 * 60 * 1000, max: 2 },
        { windowMs: 7 * 24 * 60 * 60 * 1000, max: 5 },
      ],
      dailyLimit: 5,
    },
    'claude-3-opus-20240229': {
      limits: [
        { windowMs: 5 * 60 * 1000, max: 2 },
        { windowMs: 7 * 24 * 60 * 60 * 1000, max: 5 },
      ],
      dailyLimit: 5,
    },
    'claude-3-sonnet-20240229': {
      limits: [
        { windowMs: 5 * 60 * 1000, max: 2 },
        { windowMs: 7 * 24 * 60 * 60 * 1000, max: 5 },
      ],
      dailyLimit: 5,
    },
    'claude-3-5-sonnet-20240620': {
      limits: [
        { windowMs: 5 * 60 * 1000, max: 2 },
        { windowMs: 7 * 24 * 60 * 60 * 1000, max: 5 },
      ],
      dailyLimit: 5,
    },
      'claude-instant-1.2': {
      limits: [
        { windowMs: 5 * 60 * 1000, max: 2 },
        { windowMs: 7 * 24 * 60 * 60 * 1000, max: 5 },
      ],
      dailyLimit: 15,
    },
    'claude-2': {
      limits: [
        { windowMs: 5 * 60 * 1000, max: 2 },
        { windowMs: 7 * 24 * 60 * 60 * 1000, max: 5 },
      ],
      dailyLimit: 15,
    },
    'claude-2.0': {
      limits: [
        { windowMs: 5 * 60 * 1000, max: 2 },
        { windowMs: 7 * 24 * 60 * 60 * 1000, max: 5 },
      ],
      dailyLimit: 15,
    },
    'claude-2.1': {
      limits: [
        { windowMs: 5 * 60 * 1000, max: 2 },
        { windowMs: 7 * 24 * 60 * 60 * 1000, max: 5 },
      ],
      dailyLimit: 15,
    },
    'gemini-1.5-pro-latest': {
      limits: [
        { windowMs: 3 * 1000, max: 1 },
        { windowMs: 60 * 1000, max: 10 },
        { windowMs: 30 * 60 * 1000, max: 50 },
        { windowMs: 3 * 60 * 60 * 1000, max: 100 }
      ],
      dailyLimit: 1000,
    },
    'gemini-1.5-flash-latest': {
      limits: [
        { windowMs: 2.5 * 1000, max: 1 },
        { windowMs: 60 * 1000, max: 10 },
        { windowMs: 30 * 60 * 1000, max: 50 },
        { windowMs: 3 * 60 * 60 * 1000, max: 100 }
      ],
      dailyLimit: 1000,
    },
    'gemini-2.0-flash-exp': {
      limits: [
        { windowMs: 5 * 1000, max: 1 },
        { windowMs: 90 * 1000, max: 10 },
        { windowMs: 30 * 60 * 1000, max: 50 },
        { windowMs: 3 * 60 * 60 * 1000, max: 100 }
      ],
      dailyLimit: 1000,
    },
    'gemini-2.0-flash-thinking-exp': {
      limits: [
        { windowMs: 5 * 1000, max: 1 },
        { windowMs: 90 * 1000, max: 10 },
        { windowMs: 30 * 60 * 1000, max: 50 },
        { windowMs: 3 * 60 * 60 * 1000, max: 100 }
      ],
      dailyLimit: 1000,
    },
    'gemini-exp-1206': {
      limits: [
        { windowMs: 5 * 1000, max: 1 },
        { windowMs: 90 * 1000, max: 10 },
        { windowMs: 30 * 60 * 1000, max: 50 },
        { windowMs: 3 * 60 * 60 * 1000, max: 100 }
      ],
      dailyLimit: 1000,
    },
    'Doubao-pro-4k': {
      limits: [
        { windowMs: 1 * 60 * 1000, max: 10 },
        { windowMs: 30 * 60 * 1000, max: 100 },
      ],
      dailyLimit: 1200, // Doubao-pro-4k 每天总限制 120 次
    },
    'Doubao-pro-128k': {
      limits: [
        { windowMs: 1 * 60 * 1000, max: 10 },
        { windowMs: 30 * 60 * 1000, max: 100 },
      ],
      dailyLimit: 1200, // Doubao-pro-4k 每天总限制 120 次
    },
    'Doubao-Seaweed': {
      limits: [
        { windowMs: 1 * 60 * 1000, max: 2 },
        { windowMs: 30 * 60 * 1000, max: 5 },
      ],
      dailyLimit: 50, // Doubao-pro-4k 每天总限制 120 次
    },
    'gemini-2.5-pro-exp-03-25': {
      limits: [
        { windowMs: 1 * 60 * 1000, max: 2 },
        { windowMs: 30 * 60 * 1000, max: 10 },
      ],
      dailyLimit: 800, // Doubao-pro-4k 每天总限制 120 次
    },
    'gpt-4.5-preview': {
      limits: [
        { windowMs: 1 * 60 * 1000, max: 1 },
        { windowMs: 60 * 60 * 1000, max: 3 },
      ],
      dailyLimit: 300, // Doubao-pro-4k 每天总限制 120 次
    },
    'Wan-AI/Wan2.1-I2V-14B-720P-Turbo': {
      limits: [
        { windowMs: 12 * 60 * 60 * 1000, max: 1 },
      ],
      dailyLimit: 15, 
    },
    'Wan-AI/Wan2.1-I2V-14B-720P': {
      limits: [
        { windowMs: 12 * 60 * 60 * 1000, max: 1 },
      ],
      dailyLimit: 15, 
    },
    'Wan-AI/Wan2.1-T2V-14B-Turbo': {
      limits: [
        { windowMs: 12 * 60 * 60 * 1000, max: 1 },
      ],
      dailyLimit: 15, 
    },
    'Wan-AI/Wan2.1-T2V-14B': {
      limits: [
        { windowMs: 12 * 60 * 60 * 1000, max: 1 },
      ],
      dailyLimit: 15, 
    },
    'dall-e-3': {
      limits: [
        { windowMs: 12 * 60 * 60 * 1000, max: 1 },
      ],
      dailyLimit: 3,
    }
  };