/**
 * Configuration - Environment + Constants
 */

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // LLM
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
  mainModel: process.env.AIDEN_MAIN_MODEL || 'claude-sonnet-4-20250514',
  fastModel: process.env.AIDEN_FAST_MODEL || 'claude-haiku-4-5-20251001',

  // Database
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || '',

  // Redis
  redisUrl: process.env.REDIS_URL || '',

  // Auth
  jwtSecret: process.env.JWT_SECRET || '',
  apiKeySalt: process.env.API_KEY_SALT || '',

  // Rate Limiting
  rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_REQUESTS_PER_MINUTE || '60', 10),
  rateLimitPerDay: parseInt(process.env.RATE_LIMIT_REQUESTS_PER_DAY || '10000', 10),

  // Brain defaults
  maxPhantoms: 12,
  phantomCacheTtlMs: 5 * 60 * 1000,
  haikuTimeoutMs: 5000,
  ragTokenBudget: 2000,
} as const;
