const config = require('../../config/config');
const logger = require('../utils/logger');
const cacheService = require('../services/cacheService');
const compression = require('compression');

/**
 * 🚀 性能优化中间件集合
 */

// 📊 性能监控中间件
const performanceMonitor = (req, res, next) => {
  const startTime = process.hrtime.bigint();
  const startMemory = process.memoryUsage();
  
  // 添加性能标记到请求对象
  req.performanceStart = startTime;
  req.memoryStart = startMemory;
  
  // 监听响应完成
  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const endMemory = process.memoryUsage();
    
    const duration = Number(endTime - startTime) / 1000000; // 转换为毫秒
    const memoryDelta = endMemory.heapUsed - startMemory.heapUsed;
    
    // 记录性能指标
    const perfData = {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: Math.round(duration * 100) / 100,
      memoryDelta: Math.round(memoryDelta / 1024), // KB
      contentLength: res.get('Content-Length') || 0,
      userAgent: req.get('User-Agent') || 'unknown'
    };
    
    // 性能警告阈值
    if (duration > 1000) {
      logger.warn(`🐌 Slow request detected: ${perfData.method} ${perfData.url} took ${perfData.duration}ms`, perfData);
    } else if (duration > 500) {
      logger.performance(`⚠️ Medium request: ${perfData.method} ${perfData.url} took ${perfData.duration}ms`, perfData);
    } else {
      logger.debug(`⚡ Fast request: ${perfData.method} ${perfData.url} took ${perfData.duration}ms`, perfData);
    }
    
    // 内存使用警告
    if (memoryDelta > 10 * 1024 * 1024) { // 10MB
      logger.warn(`🧠 High memory usage: ${perfData.memoryDelta}KB for ${perfData.method} ${perfData.url}`, perfData);
    }
  });
  
  next();
};

// 🗜️ 智能压缩中间件
const smartCompression = () => {
  if (!config.performance.compression.enabled) {
    return (req, res, next) => next();
  }
  
  return compression({
    level: config.performance.compression.level,
    threshold: config.performance.compression.threshold,
    filter: (req, res) => {
      // 不压缩流式响应
      if (res.getHeader('Content-Type')?.includes('text/event-stream')) {
        return false;
      }
      
      // 不压缩已经压缩的内容
      if (res.getHeader('Content-Encoding')) {
        return false;
      }
      
      // 只压缩文本类型
      const contentType = res.getHeader('Content-Type');
      if (contentType) {
        return /^(text\/|application\/(json|javascript|xml))/.test(contentType);
      }
      
      return compression.filter(req, res);
    }
  });
};

// 📋 请求信息增强中间件
const requestEnhancer = (req, res, next) => {
  // 添加请求唯一ID
  req.requestId = req.requestId || Math.random().toString(36).substring(2, 15);
  
  // 添加性能标记
  req.startTime = Date.now();
  
  // 设置响应头
  res.setHeader('X-Request-ID', req.requestId);
  res.setHeader('X-Response-Time', '0');
  
  // 监听响应完成，更新响应时间
  const originalSend = res.send;
  res.send = function(data) {
    const responseTime = Date.now() - req.startTime;
    res.setHeader('X-Response-Time', `${responseTime}ms`);
    
    return originalSend.call(this, data);
  };
  
  next();
};

// 🚦 健康检查优化中间件
const healthCheckOptimizer = (req, res, next) => {
  // 健康检查请求快速处理
  if (req.path === '/health' || req.path === '/api/health') {
    // 跳过不必要的中间件
    req.skipPerformanceLogging = true;
    req.skipAuth = true;
  }
  
  next();
};

// 📊 缓存统计中间件
const cacheStatsHeader = (req, res, next) => {
  // 在响应中添加缓存统计信息（仅开发环境）
  if (config.server.nodeEnv === 'development') {
    res.on('finish', () => {
      try {
        const stats = cacheService.getStats();
        res.setHeader('X-Cache-Stats', JSON.stringify({
          apiKeyHitRate: stats.apiKeyCache.hitRate,
          cacheKeys: stats.apiKeyCache.keys,
          batchQueues: stats.batchQueues.totalItems
        }));
      } catch (error) {
        // 忽略错误，不影响主流程
      }
    });
  }
  
  next();
};

// 🔧 响应头优化中间件
const responseOptimizer = (req, res, next) => {
  // 设置优化的响应头
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  
  // 对于API响应，设置缓存控制
  if (req.path.startsWith('/api/')) {
    // API响应不缓存
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  
  // 优化长连接
  res.setHeader('Connection', 'keep-alive');
  
  next();
};

// 🚨 错误处理优化中间件
const errorOptimizer = (error, req, res, _next) => {
  const requestId = req.requestId || 'unknown';
  const duration = Date.now() - (req.startTime || Date.now());
  
  // 记录详细错误信息
  logger.error(`💥 Request error [${requestId}]:`, {
    error: error.message,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    duration,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    body: req.body ? JSON.stringify(req.body).substring(0, 500) : undefined
  });
  
  // 设置错误响应头
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Error-Time', `${duration}ms`);
  
  // 根据错误类型返回适当的状态码
  let statusCode = 500;
  let message = 'Internal Server Error';
  
  if (error.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation Error';
  } else if (error.name === 'UnauthorizedError') {
    statusCode = 401;
    message = 'Unauthorized';
  } else if (error.name === 'ForbiddenError') {
    statusCode = 403;
    message = 'Forbidden';
  } else if (error.name === 'NotFoundError') {
    statusCode = 404;
    message = 'Not Found';
  } else if (error.name === 'TimeoutError') {
    statusCode = 408;
    message = 'Request Timeout';
  } else if (error.name === 'TooManyRequestsError') {
    statusCode = 429;
    message = 'Too Many Requests';
  }
  
  res.status(statusCode).json({
    error: message,
    message: config.server.nodeEnv === 'development' ? error.message : message,
    requestId,
    timestamp: new Date().toISOString()
  });
};

// 🧹 清理中间件（在应用关闭时调用）
const cleanup = async () => {
  try {
    await cacheService.close();
    logger.info('🧹 Performance middleware cleanup completed');
  } catch (error) {
    logger.error('❌ Performance middleware cleanup failed:', error);
  }
};

module.exports = {
  performanceMonitor,
  smartCompression,
  requestEnhancer,
  healthCheckOptimizer,
  cacheStatsHeader,
  responseOptimizer,
  errorOptimizer,
  cleanup
};