const path = require('path');
require('dotenv').config({ path: '.env.local' });

// 🛠️ 本地开发环境专用配置
// 覆盖部分生产配置以适应调试需求

const config = {
  // 🌐 服务器配置
  server: {
    port: parseInt(process.env.PORT) || 3001,
    host: process.env.HOST || '127.0.0.1',
    nodeEnv: 'development',
    trustProxy: false // 本地调试不需要代理信任
  },

  // 🔐 安全配置（降低安全级别便于调试）
  security: {
    jwtSecret: process.env.JWT_SECRET || 'local-development-jwt-secret',
    adminSessionTimeout: parseInt(process.env.ADMIN_SESSION_TIMEOUT) || 86400000,
    apiKeyPrefix: process.env.API_KEY_PREFIX || 'dev_',
    encryptionKey: process.env.ENCRYPTION_KEY || 'local-dev-32-character-key-only'
  },

  // 📊 Redis配置（本地实例）
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT) || 6380,
    password: process.env.REDIS_PASSWORD || '',
    db: parseInt(process.env.REDIS_DB) || 1, // 使用不同的数据库
    connectTimeout: 5000,
    commandTimeout: 3000,
    retryDelayOnFailover: 50,
    maxRetriesPerRequest: 2,
    lazyConnect: true,
    enableTLS: false,
    // 🚀 高性能配置（调试优化）
    family: 4,
    keepAlive: 10000,
    maxLoadingTimeout: 2000,
    enableReadyCheck: false,
    enableOfflineQueue: false,
    // 连接池配置（较小规模）
    pool: {
      min: 1,
      max: 5,
      acquireTimeoutMillis: 2000,
      idleTimeoutMillis: 5000,
      reapIntervalMillis: 1000,
      createTimeoutMillis: 2000,
      destroyTimeoutMillis: 3000
    }
  },

  // 🎯 Claude API配置
  claude: {
    apiUrl: process.env.CLAUDE_API_URL || 'https://api.anthropic.com/v1/messages',
    apiVersion: process.env.CLAUDE_API_VERSION || '2023-06-01',
    betaHeader: process.env.CLAUDE_BETA_HEADER || 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14'
  },

  // 🌐 代理配置
  proxy: {
    timeout: parseInt(process.env.DEFAULT_PROXY_TIMEOUT) || 15000, // 较短超时便于调试
    maxRetries: parseInt(process.env.MAX_PROXY_RETRIES) || 2
  },

  // 📈 使用限制（调试友好）
  limits: {
    defaultTokenLimit: parseInt(process.env.DEFAULT_TOKEN_LIMIT) || 10000
  },

  // 📝 日志配置（详细调试）
  logging: {
    level: process.env.LOG_LEVEL || 'debug',
    dirname: path.join(__dirname, '..', 'logs-dev'), // 开发专用日志目录
    maxSize: process.env.LOG_MAX_SIZE || '5m',
    maxFiles: parseInt(process.env.LOG_MAX_FILES) || 3
  },

  // 🔧 系统配置（快速调试）
  system: {
    cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL) || 600000, // 10分钟
    tokenUsageRetention: parseInt(process.env.TOKEN_USAGE_RETENTION) || 604800000, // 7天
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000, // 30秒
    timezone: process.env.SYSTEM_TIMEZONE || 'Asia/Shanghai',
    timezoneOffset: parseInt(process.env.TIMEZONE_OFFSET) || 8
  },

  // 🚀 性能优化配置（调试模式）
  performance: {
    // API Key验证缓存（较短TTL便于测试）
    apiKeyCache: {
      enabled: process.env.API_KEY_CACHE_ENABLED !== 'false',
      ttl: parseInt(process.env.API_KEY_CACHE_TTL) || 60, // 1分钟缓存
      maxSize: parseInt(process.env.API_KEY_CACHE_MAX_SIZE) || 100
    },
    // 请求去重（启用用于测试）
    requestDeduplication: {
      enabled: process.env.REQUEST_DEDUP_ENABLED === 'true',
      window: parseInt(process.env.REQUEST_DEDUP_WINDOW) || 3000, // 3秒窗口
      maxSize: parseInt(process.env.REQUEST_DEDUP_MAX_SIZE) || 1000
    },
    // 响应压缩（轻量级）
    compression: {
      enabled: process.env.COMPRESSION_ENABLED !== 'false',
      level: parseInt(process.env.COMPRESSION_LEVEL) || 3, // 较低压缩级别
      threshold: parseInt(process.env.COMPRESSION_THRESHOLD) || 512
    },
    // 批量操作（小批量便于调试）
    batchProcessing: {
      enabled: process.env.BATCH_PROCESSING_ENABLED === 'true',
      batchSize: parseInt(process.env.BATCH_SIZE) || 5,
      flushInterval: parseInt(process.env.BATCH_FLUSH_INTERVAL) || 50
    }
  },

  // 🎨 Web界面配置
  web: {
    title: process.env.WEB_TITLE || 'Claude Relay Service (Development)',
    description: process.env.WEB_DESCRIPTION || '本地开发环境',
    logoUrl: process.env.WEB_LOGO_URL || '/assets/logo.png',
    enableCors: true, // 开发环境启用CORS
    sessionSecret: process.env.WEB_SESSION_SECRET || 'dev-session-secret'
  },

  // 🔒 客户端限制配置（开发环境宽松）
  clientRestrictions: {
    predefinedClients: [
      {
        id: 'claude_code',
        name: 'ClaudeCode',
        description: 'Official Claude Code CLI',
        userAgentPattern: /^claude-cli\/[\d\.]+\s+\(/i
      },
      {
        id: 'dev_test',
        name: 'Development Test',
        description: 'Development testing client',
        userAgentPattern: /^(curl|postman|insomnia|dev)/i // 允许常见调试工具
      }
    ],
    allowCustomClients: true // 开发环境允许自定义客户端
  },

  // 🛠️ 开发配置
  development: {
    debug: true,
    hotReload: true,
    // 调试特性
    enablePerformanceHeaders: process.env.ENABLE_PERFORMANCE_HEADERS === 'true',
    enableCacheStats: process.env.ENABLE_CACHE_STATS === 'true',
    enableRequestLogging: process.env.ENABLE_REQUEST_LOGGING !== 'false'
  }
};

module.exports = config;