const NodeCache = require('node-cache');
const crypto = require('crypto');
const config = require('../../config/config');
const logger = require('../utils/logger');

/**
 * 🚀 高性能缓存服务
 * 提供内存缓存、请求去重、批量处理等性能优化功能
 */
class CacheService {
  constructor() {
    // API Key验证结果缓存
    this.apiKeyCache = new NodeCache({
      stdTTL: config.performance.apiKeyCache.ttl,
      checkperiod: 60, // 每分钟清理一次过期缓存
      maxKeys: config.performance.apiKeyCache.maxSize,
      useClones: false // 提升性能，但需要注意不要修改缓存对象
    });

    // 请求去重缓存
    this.requestDedupCache = new NodeCache({
      stdTTL: Math.ceil(config.performance.requestDeduplication.window / 1000),
      checkperiod: 30,
      maxKeys: config.performance.requestDeduplication.maxSize,
      useClones: false
    });

    // 使用统计缓存
    this.usageStatsCache = new NodeCache({
      stdTTL: 120, // 2分钟缓存
      checkperiod: 60,
      maxKeys: 500,
      useClones: false
    });

    // Claude账户列表缓存
    this.claudeAccountsCache = new NodeCache({
      stdTTL: 60, // 1分钟缓存
      checkperiod: 30,
      maxKeys: 50,
      useClones: false
    });

    // 批量操作队列
    this.batchQueues = new Map();
    this.batchTimers = new Map();

    this.setupEventListeners();
    logger.info('🚀 Cache service initialized with performance optimizations');
  }

  setupEventListeners() {
    // 缓存命中率统计
    let apiKeyCacheHits = 0;
    let apiKeyCacheMisses = 0;

    this.apiKeyCache.on('hit', () => {
      apiKeyCacheHits++;
      if ((apiKeyCacheHits + apiKeyCacheMisses) % 100 === 0) {
        const hitRate = (apiKeyCacheHits / (apiKeyCacheHits + apiKeyCacheMisses) * 100).toFixed(1);
        logger.performance(`📊 API Key cache hit rate: ${hitRate}% (${apiKeyCacheHits}/${apiKeyCacheHits + apiKeyCacheMisses})`);
      }
    });

    this.apiKeyCache.on('miss', () => {
      apiKeyCacheMisses++;
    });

    this.apiKeyCache.on('expired', (key) => {
      logger.debug(`🗑️ API Key cache expired: ${key}`);
    });
  }

  /**
   * 🔑 缓存API Key验证结果
   */
  async cacheApiKeyValidation(apiKey, validationResult) {
    if (!config.performance.apiKeyCache.enabled) return;
    
    try {
      const cacheKey = this.generateCacheKey('apikey', apiKey);
      this.apiKeyCache.set(cacheKey, validationResult);
      logger.debug(`💾 Cached API key validation: ${cacheKey}`);
    } catch (error) {
      logger.error('❌ Failed to cache API key validation:', error);
    }
  }

  /**
   * 🔍 获取缓存的API Key验证结果
   */
  async getCachedApiKeyValidation(apiKey) {
    if (!config.performance.apiKeyCache.enabled) return null;
    
    try {
      const cacheKey = this.generateCacheKey('apikey', apiKey);
      const cached = this.apiKeyCache.get(cacheKey);
      
      if (cached) {
        logger.debug(`🎯 API key cache hit: ${cacheKey}`);
        return cached;
      }
      
      logger.debug(`❌ API key cache miss: ${cacheKey}`);
      return null;
    } catch (error) {
      logger.error('❌ Failed to get cached API key validation:', error);
      return null;
    }
  }

  /**
   * 🚫 使API Key缓存失效
   */
  async invalidateApiKeyCache(apiKey) {
    try {
      const cacheKey = this.generateCacheKey('apikey', apiKey);
      this.apiKeyCache.del(cacheKey);
      logger.debug(`🗑️ Invalidated API key cache: ${cacheKey}`);
    } catch (error) {
      logger.error('❌ Failed to invalidate API key cache:', error);
    }
  }

  /**
   * 🔄 请求去重检查
   */
  async checkRequestDuplication(requestHash) {
    if (!config.performance.requestDeduplication.enabled) return false;
    
    try {
      const existing = this.requestDedupCache.get(requestHash);
      if (existing) {
        logger.warn(`🔄 Duplicate request detected: ${requestHash}`);
        return true;
      }
      
      this.requestDedupCache.set(requestHash, Date.now());
      return false;
    } catch (error) {
      logger.error('❌ Failed to check request duplication:', error);
      return false;
    }
  }

  /**
   * 🏷️ 生成请求哈希
   */
  generateRequestHash(req) {
    try {
      const key = req.headers['x-api-key'] || req.headers['authorization'];
      const body = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
      const hashContent = `${req.method}:${req.path}:${key}:${body}`;
      
      return crypto.createHash('md5').update(hashContent).digest('hex');
    } catch (error) {
      logger.error('❌ Failed to generate request hash:', error);
      return null;
    }
  }

  /**
   * 📊 缓存使用统计
   */
  async cacheUsageStats(keyId, stats) {
    try {
      const cacheKey = `usage_stats:${keyId}`;
      this.usageStatsCache.set(cacheKey, stats);
      logger.debug(`💾 Cached usage stats: ${cacheKey}`);
    } catch (error) {
      logger.error('❌ Failed to cache usage stats:', error);
    }
  }

  /**
   * 📈 获取缓存的使用统计
   */
  async getCachedUsageStats(keyId) {
    try {
      const cacheKey = `usage_stats:${keyId}`;
      const cached = this.usageStatsCache.get(cacheKey);
      
      if (cached) {
        logger.debug(`🎯 Usage stats cache hit: ${cacheKey}`);
        return cached;
      }
      
      return null;
    } catch (error) {
      logger.error('❌ Failed to get cached usage stats:', error);
      return null;
    }
  }

  /**
   * 🎯 批量处理队列
   */
  async addToBatch(queueName, item, processor) {
    if (!config.performance.batchProcessing.enabled) {
      // 如果批量处理未启用，直接处理
      return await processor([item]);
    }

    try {
      // 初始化队列
      if (!this.batchQueues.has(queueName)) {
        this.batchQueues.set(queueName, []);
      }

      const queue = this.batchQueues.get(queueName);
      queue.push({ item, processor });

      // 检查是否达到批量大小
      if (queue.length >= config.performance.batchProcessing.batchSize) {
        await this.flushBatch(queueName);
      } else {
        // 设置定时器
        this.scheduleBatchFlush(queueName);
      }
    } catch (error) {
      logger.error('❌ Failed to add to batch:', error);
      // 降级处理：直接执行
      return await processor([item]);
    }
  }

  /**
   * ⏰ 调度批量处理
   */
  scheduleBatchFlush(queueName) {
    if (this.batchTimers.has(queueName)) {
      return; // 已经有定时器了
    }

    const timer = setTimeout(() => {
      this.flushBatch(queueName);
      this.batchTimers.delete(queueName);
    }, config.performance.batchProcessing.flushInterval);

    this.batchTimers.set(queueName, timer);
  }

  /**
   * 🚀 执行批量处理
   */
  async flushBatch(queueName) {
    try {
      const queue = this.batchQueues.get(queueName);
      if (!queue || queue.length === 0) return;

      // 清空队列
      this.batchQueues.set(queueName, []);
      
      // 清除定时器
      if (this.batchTimers.has(queueName)) {
        clearTimeout(this.batchTimers.get(queueName));
        this.batchTimers.delete(queueName);
      }

      // 按处理器分组
      const processorGroups = new Map();
      for (const { item, processor } of queue) {
        const processorKey = processor.toString(); // 简单的处理器识别
        if (!processorGroups.has(processorKey)) {
          processorGroups.set(processorKey, { processor, items: [] });
        }
        processorGroups.get(processorKey).items.push(item);
      }

      // 执行批量处理
      const promises = [];
      for (const { processor, items } of processorGroups.values()) {
        promises.push(processor(items));
      }

      await Promise.all(promises);
      logger.debug(`🚀 Flushed batch ${queueName} with ${queue.length} items`);
    } catch (error) {
      logger.error(`❌ Failed to flush batch ${queueName}:`, error);
    }
  }

  /**
   * 🏷️ 生成缓存键
   */
  generateCacheKey(prefix, ...parts) {
    const content = parts.join(':');
    const hash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
    return `${prefix}:${hash}`;
  }

  /**
   * 🏢 Claude账户缓存方法
   */
  getCachedClaudeAccounts(cacheKey = 'all') {
    return this.claudeAccountsCache.get(cacheKey);
  }

  setCachedClaudeAccounts(accounts, cacheKey = 'all') {
    this.claudeAccountsCache.set(cacheKey, accounts);
    logger.debug(`📦 Cached ${accounts.length} Claude accounts with key: ${cacheKey}`);
  }

  invalidateClaudeAccountsCache() {
    this.claudeAccountsCache.flushAll();
    logger.debug('🗑️ Claude accounts cache invalidated');
  }

  /**
   * 📊 获取缓存统计
   */
  getStats() {
    return {
      apiKeyCache: {
        keys: this.apiKeyCache.keys().length,
        hits: this.apiKeyCache.getStats().hits,
        misses: this.apiKeyCache.getStats().misses,
        hitRate: (this.apiKeyCache.getStats().hits / (this.apiKeyCache.getStats().hits + this.apiKeyCache.getStats().misses) * 100).toFixed(1) + '%'
      },
      requestDedupCache: {
        keys: this.requestDedupCache.keys().length
      },
      usageStatsCache: {
        keys: this.usageStatsCache.keys().length
      },
      batchQueues: {
        activeQueues: this.batchQueues.size,
        totalItems: Array.from(this.batchQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
      }
    };
  }

  /**
   * 🧹 清理所有缓存
   */
  async clearAll() {
    try {
      this.apiKeyCache.flushAll();
      this.requestDedupCache.flushAll();
      this.usageStatsCache.flushAll();
      
      // 清理批量处理队列
      for (const timer of this.batchTimers.values()) {
        clearTimeout(timer);
      }
      this.batchQueues.clear();
      this.batchTimers.clear();
      
      logger.info('🧹 All caches cleared');
    } catch (error) {
      logger.error('❌ Failed to clear caches:', error);
    }
  }

  /**
   * 🛑 关闭缓存服务
   */
  async close() {
    try {
      // 清理所有定时器
      for (const timer of this.batchTimers.values()) {
        clearTimeout(timer);
      }
      
      // 处理剩余的批量队列
      const flushPromises = [];
      for (const queueName of this.batchQueues.keys()) {
        flushPromises.push(this.flushBatch(queueName));
      }
      await Promise.all(flushPromises);
      
      this.apiKeyCache.close();
      this.requestDedupCache.close();
      this.usageStatsCache.close();
      
      logger.info('🛑 Cache service closed');
    } catch (error) {
      logger.error('❌ Failed to close cache service:', error);
    }
  }
}

// 导出单例
const cacheService = new CacheService();
module.exports = cacheService;