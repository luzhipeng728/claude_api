const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const claudeAccountService = require('./claudeAccountService');
const sessionHelper = require('../utils/sessionHelper');
const logger = require('../utils/logger');
const config = require('../../config/config');
const claudeCodeHeadersService = require('./claudeCodeHeadersService');
const tokenCountService = require('./tokenCountService');

class ClaudeRelayService {
  constructor() {
    this.claudeApiUrl = config.claude.apiUrl;
    this.apiVersion = config.claude.apiVersion;
    this.betaHeader = config.claude.betaHeader;
    this.systemPrompt = config.claude.systemPrompt;
    this.claudeCodeSystemPrompt = 'You are Claude Code, Anthropic\'s official CLI for Claude.';
  }

  // 🔍 判断是否是真实的 Claude Code 请求
  isRealClaudeCodeRequest(requestBody, clientHeaders) {
    // 检查 user-agent 是否匹配 Claude Code 格式
    const userAgent = clientHeaders?.['user-agent'] || clientHeaders?.['User-Agent'] || '';
    const isClaudeCodeUserAgent = /claude-cli\/\d+\.\d+\.\d+/.test(userAgent);
    
    // 检查系统提示词是否包含 Claude Code 标识
    const hasClaudeCodeSystemPrompt = this._hasClaudeCodeSystemPrompt(requestBody);
    
    // 只有当 user-agent 匹配且系统提示词正确时，才认为是真实的 Claude Code 请求
    return isClaudeCodeUserAgent && hasClaudeCodeSystemPrompt;
  }

  // 🔍 检查请求中是否包含 Claude Code 系统提示词
  _hasClaudeCodeSystemPrompt(requestBody) {
    if (!requestBody || !requestBody.system) return false;
    
    // 如果是字符串格式，一定不是真实的 Claude Code 请求
    if (typeof requestBody.system === 'string') {
      return false;
    } 
    
    // 处理数组格式
    if (Array.isArray(requestBody.system) && requestBody.system.length > 0) {
      const firstItem = requestBody.system[0];
      // 检查第一个元素是否包含 Claude Code 提示词
      return firstItem && 
             firstItem.type === 'text' && 
             firstItem.text && 
             firstItem.text === this.claudeCodeSystemPrompt;
    }
    
    return false;
  }

  // 🚀 转发请求到Claude API
  async relayRequest(requestBody, apiKeyData, clientRequest, clientResponse, clientHeaders, options = {}) {
    let upstreamRequest = null;
    
    try {
      // 调试日志：查看API Key数据
      logger.info('🔍 API Key data received:', {
        apiKeyName: apiKeyData.name,
        enableModelRestriction: apiKeyData.enableModelRestriction,
        restrictedModels: apiKeyData.restrictedModels,
        requestedModel: requestBody.model
      });

      // 检查模型限制
      if (apiKeyData.enableModelRestriction && apiKeyData.restrictedModels && apiKeyData.restrictedModels.length > 0) {
        const requestedModel = requestBody.model;
        logger.info(`🔒 Model restriction check - Requested model: ${requestedModel}, Restricted models: ${JSON.stringify(apiKeyData.restrictedModels)}`);
        
        if (requestedModel && apiKeyData.restrictedModels.includes(requestedModel)) {
          logger.warn(`🚫 Model restriction violation for key ${apiKeyData.name}: Attempted to use restricted model ${requestedModel}`);
          return {
            statusCode: 403,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              error: {
                type: 'forbidden',
                message: '暂无该模型访问权限'
              }
            })
          };
        }
      }
      
      // 生成会话哈希用于sticky会话
      const sessionHash = sessionHelper.generateSessionHash(requestBody);
      
      // 选择可用的Claude账户（支持专属绑定和sticky会话）
      const accountId = await claudeAccountService.selectAccountForApiKey(apiKeyData, sessionHash);
      
      logger.info(`📤 Processing API request for key: ${apiKeyData.name || apiKeyData.id}, account: ${accountId}${sessionHash ? `, session: ${sessionHash}` : ''}`);
      
      // 获取有效的访问token
      const accessToken = await claudeAccountService.getValidAccessToken(accountId);
      
      // 处理请求体（传递 clientHeaders 以判断是否需要设置 Claude Code 系统提示词）
      const processedBody = this._processRequestBody(requestBody, clientHeaders);
      
      // 🔍 检查 AWS/Databricks key 的最小 token 限制
      if (apiKeyData.keyType === 'aws' || apiKeyData.keyType === 'databricks') {
        try {
          const inputTokens = await tokenCountService.countInputTokens(processedBody, accountId);
          logger.info(`📊 Token count for ${apiKeyData.keyType} key: ${inputTokens} tokens`);
          
          if (inputTokens < 250) {
            logger.warn(`🚦 Token limit check failed for ${apiKeyData.keyType} key: ${inputTokens} < 250 tokens`);
            
            // 返回 429 错误
            const error = new Error('Minimum token requirement not met');
            error.status = 429;
            error.details = {
              error: 'Too Few Tokens',
              message: `${apiKeyData.keyType.toUpperCase()} keys require a minimum of 250 input tokens. Current request: ${inputTokens} tokens.`,
              type: 'token_limit_error',
              current_tokens: inputTokens,
              minimum_tokens: 250,
              retry_after: 60 // 建议等待时间
            };
            throw error;
          }
        } catch (tokenError) {
          // 如果是 token 限制错误，直接抛出
          if (tokenError.status === 429) {
            throw tokenError;
          }
          
          // 如果是 token 计算错误，记录警告但继续处理请求
          logger.warn('⚠️ Token count calculation failed, proceeding with request:', {
            error: tokenError.message,
            keyType: apiKeyData.keyType,
            keyName: apiKeyData.name
          });
        }
      }
      
      // 获取代理配置
      const proxyAgent = await this._getProxyAgent(accountId);
      
      // 设置客户端断开监听器
      const handleClientDisconnect = () => {
        logger.info('🔌 Client disconnected, aborting upstream request');
        if (upstreamRequest && !upstreamRequest.destroyed) {
          upstreamRequest.destroy();
        }
      };
      
      // 监听客户端断开事件
      if (clientRequest) {
        clientRequest.once('close', handleClientDisconnect);
      }
      if (clientResponse) {
        clientResponse.once('close', handleClientDisconnect);
      }
      
      // 发送请求到Claude API（传入回调以获取请求对象）
      const response = await this._makeClaudeRequest(
        processedBody, 
        accessToken, 
        proxyAgent,
        clientHeaders,
        accountId,
        (req) => { upstreamRequest = req; },
        options
      );
      
      // 移除监听器（请求成功完成）
      if (clientRequest) {
        clientRequest.removeListener('close', handleClientDisconnect);
      }
      if (clientResponse) {
        clientResponse.removeListener('close', handleClientDisconnect);
      }
      
      // 检查响应是否为限流错误
      if (response.statusCode !== 200 && response.statusCode !== 201) {
        let isRateLimited = false;
        try {
          const responseBody = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
          if (responseBody && responseBody.error && responseBody.error.message && 
              responseBody.error.message.toLowerCase().includes('exceed your account\'s rate limit')) {
            isRateLimited = true;
          }
        } catch (e) {
          // 如果解析失败，检查原始字符串
          if (response.body && response.body.toLowerCase().includes('exceed your account\'s rate limit')) {
            isRateLimited = true;
          }
        }
        
        if (isRateLimited) {
          logger.warn(`🚫 Rate limit detected for account ${accountId}, status: ${response.statusCode}`);
          // 标记账号为限流状态并删除粘性会话映射
          await claudeAccountService.markAccountRateLimited(accountId, sessionHash);
        }
      } else if (response.statusCode === 200 || response.statusCode === 201) {
        // 如果请求成功，检查并移除限流状态
        const isRateLimited = await claudeAccountService.isAccountRateLimited(accountId);
        if (isRateLimited) {
          await claudeAccountService.removeAccountRateLimit(accountId);
        }
        
        // 只有真实的 Claude Code 请求才更新 headers
        if (clientHeaders && Object.keys(clientHeaders).length > 0 && this.isRealClaudeCodeRequest(requestBody, clientHeaders)) {
          await claudeCodeHeadersService.storeAccountHeaders(accountId, clientHeaders);
        }
      }
      
      // 记录成功的API调用
      const inputTokens = requestBody.messages ? 
        requestBody.messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0) / 4 : 0; // 粗略估算
      const outputTokens = response.content ? 
        response.content.reduce((sum, content) => sum + (content.text?.length || 0), 0) / 4 : 0;
      
      logger.info(`✅ API request completed - Key: ${apiKeyData.name}, Account: ${accountId}, Model: ${requestBody.model}, Input: ~${Math.round(inputTokens)} tokens, Output: ~${Math.round(outputTokens)} tokens`);
      
      // 在响应中添加accountId，以便调用方记录账户级别统计
      response.accountId = accountId;
      
      // 根据API Key类型处理响应
      const processedResponse = this._processResponseByKeyType(response, apiKeyData.keyType || 'cc');
      
      return processedResponse;
    } catch (error) {
      logger.error(`❌ Claude relay request failed for key: ${apiKeyData.name || apiKeyData.id}:`, error.message);
      throw error;
    }
  }

  // 🔄 处理请求体
  _processRequestBody(body, clientHeaders = {}) {
    if (!body) return body;

    // 深拷贝请求体
    const processedBody = JSON.parse(JSON.stringify(body));

    // 验证并限制max_tokens参数
    this._validateAndLimitMaxTokens(processedBody);

    // 移除cache_control中的ttl字段
    this._stripTtlFromCacheControl(processedBody);

    // 判断是否是真实的 Claude Code 请求
    const isRealClaudeCode = this.isRealClaudeCodeRequest(processedBody, clientHeaders);
    
    // 如果不是真实的 Claude Code 请求，需要设置 Claude Code 系统提示词
    if (!isRealClaudeCode) {
      const claudeCodePrompt = {
        type: 'text',
        text: this.claudeCodeSystemPrompt,
        cache_control: {
          type: 'ephemeral'
        }
      };

      if (processedBody.system) {
        if (typeof processedBody.system === 'string') {
          // 字符串格式：转换为数组，Claude Code 提示词在第一位
          const userSystemPrompt = {
            type: 'text',
            text: processedBody.system
          };
          // 如果用户的提示词与 Claude Code 提示词相同，只保留一个
          if (processedBody.system.trim() === this.claudeCodeSystemPrompt) {
            processedBody.system = [claudeCodePrompt];
          } else {
            processedBody.system = [claudeCodePrompt, userSystemPrompt];
          }
        } else if (Array.isArray(processedBody.system)) {
          // 检查第一个元素是否是 Claude Code 系统提示词
          const firstItem = processedBody.system[0];
          const isFirstItemClaudeCode = firstItem && 
                                        firstItem.type === 'text' && 
                                        firstItem.text === this.claudeCodeSystemPrompt;
          
          if (!isFirstItemClaudeCode) {
            // 如果第一个不是 Claude Code 提示词，需要在开头插入
            // 同时检查数组中是否有其他位置包含 Claude Code 提示词，如果有则移除
            const filteredSystem = processedBody.system.filter(item => 
              !(item && item.type === 'text' && item.text === this.claudeCodeSystemPrompt)
            );
            processedBody.system = [claudeCodePrompt, ...filteredSystem];
          }
        } else {
          // 其他格式，记录警告但不抛出错误，尝试处理
          logger.warn('⚠️ Unexpected system field type:', typeof processedBody.system);
          processedBody.system = [claudeCodePrompt];
        }
      } else {
        // 用户没有传递 system，需要添加 Claude Code 提示词
        processedBody.system = [claudeCodePrompt];
      }
    }
    
    // 处理原有的系统提示（如果配置了）
    if (this.systemPrompt && this.systemPrompt.trim()) {
      const systemPrompt = {
        type: 'text',
        text: this.systemPrompt
      };

      // 经过上面的处理，system 现在应该总是数组格式
      if (processedBody.system && Array.isArray(processedBody.system)) {
        // 不要重复添加相同的系统提示
        const hasSystemPrompt = processedBody.system.some(item => 
          item && item.text && item.text === this.systemPrompt
        );
        if (!hasSystemPrompt) {
          processedBody.system.push(systemPrompt);
        }
      } else {
        // 理论上不应该走到这里，但为了安全起见
        processedBody.system = [systemPrompt];
      }
    } else {
      // 如果没有配置系统提示，且system字段为空，则删除它
      if (processedBody.system && Array.isArray(processedBody.system)) {
        const hasValidContent = processedBody.system.some(item => 
          item && item.text && item.text.trim()
        );
        if (!hasValidContent) {
          delete processedBody.system;
        }
      }
    }

    return processedBody;
  }

  // 🔢 验证并限制max_tokens参数
  _validateAndLimitMaxTokens(body) {
    if (!body || !body.max_tokens) return;

    try {
      // 读取模型定价配置文件
      const pricingFilePath = path.join(__dirname, '../../data/model_pricing.json');
      
      if (!fs.existsSync(pricingFilePath)) {
        logger.warn('⚠️ Model pricing file not found, skipping max_tokens validation');
        return;
      }

      const pricingData = JSON.parse(fs.readFileSync(pricingFilePath, 'utf8'));
      const model = body.model || 'claude-sonnet-4-20250514';
      
      // 查找对应模型的配置
      const modelConfig = pricingData[model];
      
      if (!modelConfig) {
        logger.debug(`🔍 Model ${model} not found in pricing file, skipping max_tokens validation`);
        return;
      }

      // 获取模型的最大token限制
      const maxLimit = modelConfig.max_tokens || modelConfig.max_output_tokens;
      
      if (!maxLimit) {
        logger.debug(`🔍 No max_tokens limit found for model ${model}, skipping validation`);
        return;
      }

      // 检查并调整max_tokens
      if (body.max_tokens > maxLimit) {
        logger.warn(`⚠️ max_tokens ${body.max_tokens} exceeds limit ${maxLimit} for model ${model}, adjusting to ${maxLimit}`);
        body.max_tokens = maxLimit;
      }
    } catch (error) {
      logger.error('❌ Failed to validate max_tokens from pricing file:', error);
      // 如果文件读取失败，不进行校验，让请求继续处理
    }
  }

  // 🧹 移除TTL字段
  _stripTtlFromCacheControl(body) {
    if (!body || typeof body !== 'object') return;

    const processContentArray = (contentArray) => {
      if (!Array.isArray(contentArray)) return;
      
      contentArray.forEach(item => {
        if (item && typeof item === 'object' && item.cache_control) {
          if (item.cache_control.ttl) {
            delete item.cache_control.ttl;
            logger.debug('🧹 Removed ttl from cache_control');
          }
        }
      });
    };

    if (Array.isArray(body.system)) {
      processContentArray(body.system);
    }

    if (Array.isArray(body.messages)) {
      body.messages.forEach(message => {
        if (message && Array.isArray(message.content)) {
          processContentArray(message.content);
        }
      });
    }
  }

  // 🌐 获取代理Agent
  async _getProxyAgent(accountId) {
    try {
      const accountData = await claudeAccountService.getAllAccounts();
      const account = accountData.find(acc => acc.id === accountId);
      
      if (!account || !account.proxy) {
        return null;
      }

      const proxy = account.proxy;
      
      if (proxy.type === 'socks5') {
        const auth = proxy.username && proxy.password ? `${proxy.username}:${proxy.password}@` : '';
        const socksUrl = `socks5://${auth}${proxy.host}:${proxy.port}`;
        return new SocksProxyAgent(socksUrl);
      } else if (proxy.type === 'http' || proxy.type === 'https') {
        const auth = proxy.username && proxy.password ? `${proxy.username}:${proxy.password}@` : '';
        const httpUrl = `${proxy.type}://${auth}${proxy.host}:${proxy.port}`;
        return new HttpsProxyAgent(httpUrl);
      }
    } catch (error) {
      logger.warn('⚠️ Failed to create proxy agent:', error);
    }

    return null;
  }

  // 🔧 过滤客户端请求头
  _filterClientHeaders(clientHeaders) {
    // 需要移除的敏感 headers
    const sensitiveHeaders = [
      'x-api-key',
      'authorization',
      'host',
      'content-length',
      'connection',
      'proxy-authorization',
      'content-encoding',
      'transfer-encoding'
    ];
    
    // 应该保留的 headers（用于会话一致性和追踪）
    const allowedHeaders = [
      'x-request-id'
    ];
    
    const filteredHeaders = {};
    
    // 转发客户端的非敏感 headers
    Object.keys(clientHeaders || {}).forEach(key => {
      const lowerKey = key.toLowerCase();
      // 如果在允许列表中，直接保留
      if (allowedHeaders.includes(lowerKey)) {
        filteredHeaders[key] = clientHeaders[key];
      } 
      // 如果不在敏感列表中，也保留
      else if (!sensitiveHeaders.includes(lowerKey)) {
        filteredHeaders[key] = clientHeaders[key];
      }
    });
    
    return filteredHeaders;
  }

  // 🔗 发送请求到Claude API
  async _makeClaudeRequest(body, accessToken, proxyAgent, clientHeaders, accountId, onRequest, requestOptions = {}) {
    const url = new URL(this.claudeApiUrl);
    
    // 获取过滤后的客户端 headers
    const filteredHeaders = this._filterClientHeaders(clientHeaders);
    
    // 判断是否是真实的 Claude Code 请求
    const isRealClaudeCode = this.isRealClaudeCodeRequest(body, clientHeaders);
    
    // 如果不是真实的 Claude Code 请求，需要使用从账户获取的 Claude Code headers
    let finalHeaders = { ...filteredHeaders };
    
    if (!isRealClaudeCode) {
      // 获取该账号存储的 Claude Code headers
      const claudeCodeHeaders = await claudeCodeHeadersService.getAccountHeaders(accountId);
      
      // 只添加客户端没有提供的 headers
      Object.keys(claudeCodeHeaders).forEach(key => {
        const lowerKey = key.toLowerCase();
        if (!finalHeaders[key] && !finalHeaders[lowerKey]) {
          finalHeaders[key] = claudeCodeHeaders[key];
        }
      });
    }
    
    return new Promise((resolve, reject) => {
      
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'anthropic-version': this.apiVersion,
          ...finalHeaders
        },
        agent: proxyAgent,
        timeout: config.proxy.timeout
      };
      
      // 如果客户端没有提供 User-Agent，使用默认值
      if (!options.headers['User-Agent'] && !options.headers['user-agent']) {
        options.headers['User-Agent'] = 'claude-cli/1.0.57 (external, cli)';
      }

      // 使用自定义的 betaHeader 或默认值
      const betaHeader = requestOptions?.betaHeader !== undefined ? requestOptions.betaHeader : this.betaHeader;
      if (betaHeader) {
        options.headers['anthropic-beta'] = betaHeader;
      }

      const req = https.request(options, (res) => {
        let responseData = Buffer.alloc(0);
        
        res.on('data', (chunk) => {
          responseData = Buffer.concat([responseData, chunk]);
        });
        
        res.on('end', () => {
          try {
            let bodyString = '';
            
            // 根据Content-Encoding处理响应数据
            const contentEncoding = res.headers['content-encoding'];
            if (contentEncoding === 'gzip') {
              try {
                bodyString = zlib.gunzipSync(responseData).toString('utf8');
              } catch (unzipError) {
                logger.error('❌ Failed to decompress gzip response:', unzipError);
                bodyString = responseData.toString('utf8');
              }
            } else if (contentEncoding === 'deflate') {
              try {
                bodyString = zlib.inflateSync(responseData).toString('utf8');
              } catch (unzipError) {
                logger.error('❌ Failed to decompress deflate response:', unzipError);
                bodyString = responseData.toString('utf8');
              }
            } else {
              bodyString = responseData.toString('utf8');
            }
            
            const response = {
              statusCode: res.statusCode,
              headers: res.headers,
              body: bodyString
            };
            
            logger.debug(`🔗 Claude API response: ${res.statusCode}`);
            
            resolve(response);
          } catch (error) {
            logger.error('❌ Failed to parse Claude API response:', error);
            reject(error);
          }
        });
      });
      
      // 如果提供了 onRequest 回调，传递请求对象
      if (onRequest && typeof onRequest === 'function') {
        onRequest(req);
      }

      req.on('error', (error) => {
        logger.error('❌ Claude API request error:', error.message, {
          code: error.code,
          errno: error.errno,
          syscall: error.syscall,
          address: error.address,
          port: error.port
        });
        
        // 根据错误类型提供更具体的错误信息
        let errorMessage = 'Upstream request failed';
        if (error.code === 'ECONNRESET') {
          errorMessage = 'Connection reset by Claude API server';
        } else if (error.code === 'ENOTFOUND') {
          errorMessage = 'Unable to resolve Claude API hostname';
        } else if (error.code === 'ECONNREFUSED') {
          errorMessage = 'Connection refused by Claude API server';
        } else if (error.code === 'ETIMEDOUT') {
          errorMessage = 'Connection timed out to Claude API server';
        }
        
        reject(new Error(errorMessage));
      });

      req.on('timeout', () => {
        req.destroy();
        logger.error('❌ Claude API request timeout');
        reject(new Error('Request timeout'));
      });

      // 写入请求体
      req.write(JSON.stringify(body));
      req.end();
    });
  }

  // 🌊 处理流式响应（带usage数据捕获）
  async relayStreamRequestWithUsageCapture(requestBody, apiKeyData, responseStream, clientHeaders, usageCallback, streamTransformer = null, options = {}) {
    try {
      // 调试日志：查看API Key数据（流式请求）
      logger.info('🔍 [Stream] API Key data received:', {
        apiKeyName: apiKeyData.name,
        enableModelRestriction: apiKeyData.enableModelRestriction,
        restrictedModels: apiKeyData.restrictedModels,
        requestedModel: requestBody.model
      });

      // 检查模型限制
      if (apiKeyData.enableModelRestriction && apiKeyData.restrictedModels && apiKeyData.restrictedModels.length > 0) {
        const requestedModel = requestBody.model;
        logger.info(`🔒 [Stream] Model restriction check - Requested model: ${requestedModel}, Restricted models: ${JSON.stringify(apiKeyData.restrictedModels)}`);
        
        if (requestedModel && apiKeyData.restrictedModels.includes(requestedModel)) {
          logger.warn(`🚫 Model restriction violation for key ${apiKeyData.name}: Attempted to use restricted model ${requestedModel}`);
          
          // 对于流式响应，需要写入错误并结束流
          const errorResponse = JSON.stringify({
            error: {
              type: 'forbidden',
              message: '暂无该模型访问权限'
            }
          });
          
          responseStream.writeHead(403, { 'Content-Type': 'application/json' });
          responseStream.end(errorResponse);
          return;
        }
      }
      
      // 生成会话哈希用于sticky会话
      const sessionHash = sessionHelper.generateSessionHash(requestBody);
      
      // 选择可用的Claude账户（支持专属绑定和sticky会话）
      const accountId = await claudeAccountService.selectAccountForApiKey(apiKeyData, sessionHash);
      
      logger.info(`📡 Processing streaming API request with usage capture for key: ${apiKeyData.name || apiKeyData.id}, account: ${accountId}${sessionHash ? `, session: ${sessionHash}` : ''}`);
      
      // 获取有效的访问token
      const accessToken = await claudeAccountService.getValidAccessToken(accountId);
      
      // 处理请求体（传递 clientHeaders 以判断是否需要设置 Claude Code 系统提示词）
      const processedBody = this._processRequestBody(requestBody, clientHeaders);
      
      // 🔍 检查 AWS/Databricks key 的最小 token 限制 (流式)
      if (apiKeyData.keyType === 'aws' || apiKeyData.keyType === 'databricks') {
        try {
          const inputTokens = await tokenCountService.countInputTokens(processedBody, accountId);
          logger.info(`📊 [Stream] Token count for ${apiKeyData.keyType} key: ${inputTokens} tokens`);
          
          if (inputTokens < 250) {
            logger.warn(`🚦 [Stream] Token limit check failed for ${apiKeyData.keyType} key: ${inputTokens} < 250 tokens`);
            
            // 对于流式响应，需要写入错误事件并结束流
            const errorResponse = {
              error: 'Too Few Tokens',
              message: `${apiKeyData.keyType.toUpperCase()} keys require a minimum of 250 input tokens. Current request: ${inputTokens} tokens.`,
              type: 'token_limit_error',
              current_tokens: inputTokens,
              minimum_tokens: 250,
              retry_after: 60
            };
            
            if (!responseStream.destroyed) {
              responseStream.writeHead(429, {
                'Content-Type': 'application/json',
                'X-Error-Type': 'token_limit_error',
                'Retry-After': '60'
              });
              responseStream.write(JSON.stringify(errorResponse));
              responseStream.end();
            }
            return;
          }
        } catch (tokenError) {
          // 如果是 token 计算错误，记录警告但继续处理请求
          logger.warn('⚠️ [Stream] Token count calculation failed, proceeding with request:', {
            error: tokenError.message,
            keyType: apiKeyData.keyType,
            keyName: apiKeyData.name
          });
        }
      }
      
      // 获取代理配置
      const proxyAgent = await this._getProxyAgent(accountId);
      
      // 发送流式请求并捕获usage数据
      return await this._makeClaudeStreamRequestWithUsageCapture(processedBody, accessToken, proxyAgent, clientHeaders, responseStream, (usageData) => {
        // 在usageCallback中添加accountId
        usageCallback({ ...usageData, accountId });
      }, accountId, sessionHash, streamTransformer, options, apiKeyData.keyType || 'cc');
    } catch (error) {
      logger.error('❌ Claude stream relay with usage capture failed:', error);
      throw error;
    }
  }

  // 🌊 发送流式请求到Claude API（带usage数据捕获）
  async _makeClaudeStreamRequestWithUsageCapture(body, accessToken, proxyAgent, clientHeaders, responseStream, usageCallback, accountId, sessionHash, streamTransformer = null, requestOptions = {}, keyType = 'cc') {
    // 获取过滤后的客户端 headers
    const filteredHeaders = this._filterClientHeaders(clientHeaders);
    
    // 判断是否是真实的 Claude Code 请求
    const isRealClaudeCode = this.isRealClaudeCodeRequest(body, clientHeaders);
    
    // 如果不是真实的 Claude Code 请求，需要使用从账户获取的 Claude Code headers
    let finalHeaders = { ...filteredHeaders };
    
    if (!isRealClaudeCode) {
      // 获取该账号存储的 Claude Code headers
      const claudeCodeHeaders = await claudeCodeHeadersService.getAccountHeaders(accountId);
      
      // 只添加客户端没有提供的 headers
      Object.keys(claudeCodeHeaders).forEach(key => {
        const lowerKey = key.toLowerCase();
        if (!finalHeaders[key] && !finalHeaders[lowerKey]) {
          finalHeaders[key] = claudeCodeHeaders[key];
        }
      });
    }
    
    return new Promise((resolve, reject) => {
      const url = new URL(this.claudeApiUrl);
      
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'anthropic-version': this.apiVersion,
          ...finalHeaders
        },
        agent: proxyAgent,
        timeout: config.proxy.timeout
      };
      
      // 如果客户端没有提供 User-Agent，使用默认值
      if (!options.headers['User-Agent'] && !options.headers['user-agent']) {
        options.headers['User-Agent'] = 'claude-cli/1.0.57 (external, cli)';
      }

      // 使用自定义的 betaHeader 或默认值
      const betaHeader = requestOptions?.betaHeader !== undefined ? requestOptions.betaHeader : this.betaHeader;
      if (betaHeader) {
        options.headers['anthropic-beta'] = betaHeader;
      }

      const req = https.request(options, (res) => {
        logger.debug(`🌊 Claude stream response status: ${res.statusCode}`);

        // 错误响应处理
        if (res.statusCode !== 200) {
          logger.error(`❌ Claude API returned error status: ${res.statusCode}`);
          let errorData = '';
          
          res.on('data', (chunk) => {
            errorData += chunk.toString();
          });
          
          res.on('end', () => {
            logger.error('❌ Claude API error response:', errorData);
            if (!responseStream.destroyed) {
              // 发送错误事件
              responseStream.write('event: error\n');
              responseStream.write(`data: ${JSON.stringify({ 
                error: 'Claude API error',
                status: res.statusCode,
                details: errorData,
                timestamp: new Date().toISOString()
              })}\n\n`);
              responseStream.end();
            }
            reject(new Error(`Claude API error: ${res.statusCode}`));
          });
          return;
        }

        // 设置响应头（根据keyType）
        if (keyType === 'aws' || keyType === 'databricks') {
          const modifiedHeaders = this._modifyHeadersForKeyType(res.headers, keyType, true); // 流式=true
          // 设置修改后的headers到响应流
          Object.keys(modifiedHeaders).forEach(key => {
            responseStream.setHeader(key, modifiedHeaders[key]);
          });
        } else if (keyType === 'anthropic') {
          const modifiedHeaders = this._modifyHeadersForKeyType(res.headers, keyType, true); // 流式=true
          // 设置修改后的headers到响应流
          Object.keys(modifiedHeaders).forEach(key => {
            responseStream.setHeader(key, modifiedHeaders[key]);
          });
        } else {
          // 默认情况下转发原始headers
          Object.keys(res.headers).forEach(key => {
            responseStream.setHeader(key, res.headers[key]);
          });
        }

        let buffer = '';
        let finalUsageReported = false; // 防止重复统计的标志
        let collectedUsageData = {}; // 收集来自不同事件的usage数据
        let rateLimitDetected = false; // 限流检测标志
        
        // 监听数据块，解析SSE并寻找usage信息
        res.on('data', (chunk) => {
          try {
            const chunkStr = chunk.toString();
            
            buffer += chunkStr;
            
            // 处理完整的SSE行
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // 保留最后的不完整行
            
            // 转发已处理的完整行到客户端
            if (lines.length > 0 && !responseStream.destroyed) {
              let linesToForward = lines.join('\n') + (lines.length > 0 ? '\n' : '');
              
              // 根据keyType处理流式数据
              if (keyType === 'aws' || keyType === 'databricks') {
                linesToForward = this._processStreamDataForBedrock(linesToForward, keyType);
              } else if (keyType === 'cc' || keyType === 'anthropic') {
                linesToForward = this._processStreamDataForClaudeCode(linesToForward);
              }
              
              // 如果有流转换器，应用转换
              if (streamTransformer) {
                const transformed = streamTransformer(linesToForward);
                if (transformed) {
                  responseStream.write(transformed);
                }
              } else {
                responseStream.write(linesToForward);
              }
            }
          
          for (const line of lines) {
            // 解析SSE数据寻找usage信息
            if (line.startsWith('data: ') && line.length > 6) {
              try {
                const jsonStr = line.slice(6);
                const data = JSON.parse(jsonStr);
                
                // 收集来自不同事件的usage数据
                if (data.type === 'message_start' && data.message && data.message.usage) {
                  // message_start包含input tokens、cache tokens和模型信息
                  const originalInputTokens = data.message.usage.input_tokens || 0;
                  collectedUsageData.input_tokens = originalInputTokens;
                  collectedUsageData.cache_creation_input_tokens = data.message.usage.cache_creation_input_tokens || 0;
                  collectedUsageData.cache_read_input_tokens = data.message.usage.cache_read_input_tokens || 0;
                  collectedUsageData.model = data.message.model;
                  
                  // 🔧 根据keyType修改usage统计数据
                  if (keyType === 'aws') {
                    // AWS类型：保留cache tokens，input_tokens减14
                    collectedUsageData.input_tokens = originalInputTokens > 14 ? originalInputTokens - 14 : originalInputTokens;
                    // cache tokens保持不变
                  } else if (keyType === 'databricks') {
                    // Databricks类型：input_tokens = input + cache_read + cache_creation - 14，然后清零cache
                    const totalInputTokens = originalInputTokens + collectedUsageData.cache_read_input_tokens + collectedUsageData.cache_creation_input_tokens;
                    collectedUsageData.input_tokens = totalInputTokens > 14 ? totalInputTokens - 14 : totalInputTokens;
                    collectedUsageData.cache_creation_input_tokens = 0;
                    collectedUsageData.cache_read_input_tokens = 0;
                  } else {
                    // 其他类型(cc, anthropic等)：input_tokens都要减14
                    collectedUsageData.input_tokens = originalInputTokens > 14 ? originalInputTokens - 14 : originalInputTokens;
                  }
                  
                  logger.info('📊 Collected input/cache data from message_start:', JSON.stringify(collectedUsageData));
                }
                
                // message_delta包含最终的output tokens
                if (data.type === 'message_delta' && data.usage && data.usage.output_tokens !== undefined) {
                  collectedUsageData.output_tokens = data.usage.output_tokens || 0;
                  
                  logger.info('📊 Collected output data from message_delta:', JSON.stringify(collectedUsageData));
                  
                  // 如果已经收集到了input数据，现在有了output数据，可以统计了
                  if (collectedUsageData.input_tokens !== undefined && !finalUsageReported) {
                    logger.info('🎯 Complete usage data collected, triggering callback');
                    usageCallback(collectedUsageData);
                    finalUsageReported = true;
                  }
                }
                
                // 检查是否有限流错误
                if (data.type === 'error' && data.error && data.error.message && 
                    data.error.message.toLowerCase().includes('exceed your account\'s rate limit')) {
                  rateLimitDetected = true;
                  logger.warn(`🚫 Rate limit detected in stream for account ${accountId}`);
                }
                
              } catch (parseError) {
                // 忽略JSON解析错误，继续处理
                logger.debug('🔍 SSE line not JSON or no usage data:', line.slice(0, 100));
              }
            }
          }
          } catch (error) {
            logger.error('❌ Error processing stream data:', error);
            // 发送错误但不破坏流，让它自然结束
            if (!responseStream.destroyed) {
              responseStream.write('event: error\n');
              responseStream.write(`data: ${JSON.stringify({ 
                error: 'Stream processing error',
                message: error.message,
                timestamp: new Date().toISOString()
              })}\n\n`);
            }
          }
        });
        
        res.on('end', async () => {
          try {
            // 处理缓冲区中剩余的数据
            if (buffer.trim() && !responseStream.destroyed) {
              let finalBuffer = buffer;
              
              // 根据keyType处理流式数据
              if (keyType === 'aws' || keyType === 'databricks') {
                finalBuffer = this._processStreamDataForBedrock(finalBuffer, keyType);
              } else if (keyType === 'cc' || keyType === 'anthropic') {
                finalBuffer = this._processStreamDataForClaudeCode(finalBuffer);
              }
              
              if (streamTransformer) {
                const transformed = streamTransformer(finalBuffer);
                if (transformed) {
                  responseStream.write(transformed);
                }
              } else {
                responseStream.write(finalBuffer);
              }
            }
            
            // 确保流正确结束
            if (!responseStream.destroyed) {
              responseStream.end();
            }
          } catch (error) {
            logger.error('❌ Error processing stream end:', error);
          }
          
          // 检查是否捕获到usage数据
          if (!finalUsageReported) {
            logger.warn('⚠️ Stream completed but no usage data was captured! This indicates a problem with SSE parsing or Claude API response format.');
          }
          
          // 处理限流状态
          if (rateLimitDetected || res.statusCode === 429) {
            // 标记账号为限流状态并删除粘性会话映射
            await claudeAccountService.markAccountRateLimited(accountId, sessionHash);
          } else if (res.statusCode === 200) {
            // 如果请求成功，检查并移除限流状态
            const isRateLimited = await claudeAccountService.isAccountRateLimited(accountId);
            if (isRateLimited) {
              await claudeAccountService.removeAccountRateLimit(accountId);
            }
            
            // 只有真实的 Claude Code 请求才更新 headers（流式请求）
            if (clientHeaders && Object.keys(clientHeaders).length > 0 && this.isRealClaudeCodeRequest(body, clientHeaders)) {
              await claudeCodeHeadersService.storeAccountHeaders(accountId, clientHeaders);
            }
          }
          
          logger.debug('🌊 Claude stream response with usage capture completed');
          resolve();
        });
      });

      req.on('error', (error) => {
        logger.error('❌ Claude stream request error:', error.message, {
          code: error.code,
          errno: error.errno,
          syscall: error.syscall
        });
        
        // 根据错误类型提供更具体的错误信息
        let errorMessage = 'Upstream request failed';
        let statusCode = 500;
        if (error.code === 'ECONNRESET') {
          errorMessage = 'Connection reset by Claude API server';
          statusCode = 502;
        } else if (error.code === 'ENOTFOUND') {
          errorMessage = 'Unable to resolve Claude API hostname';
          statusCode = 502;
        } else if (error.code === 'ECONNREFUSED') {
          errorMessage = 'Connection refused by Claude API server';
          statusCode = 502;
        } else if (error.code === 'ETIMEDOUT') {
          errorMessage = 'Connection timed out to Claude API server';
          statusCode = 504;
        }
        
        if (!responseStream.headersSent) {
          responseStream.writeHead(statusCode, { 
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
        }
        
        if (!responseStream.destroyed) {
          // 发送 SSE 错误事件
          responseStream.write('event: error\n');
          responseStream.write(`data: ${JSON.stringify({ 
            error: errorMessage,
            code: error.code,
            timestamp: new Date().toISOString()
          })}\n\n`);
          responseStream.end();
        }
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        logger.error('❌ Claude stream request timeout');
        if (!responseStream.headersSent) {
          responseStream.writeHead(504, { 
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
        }
        if (!responseStream.destroyed) {
          // 发送 SSE 错误事件
          responseStream.write('event: error\n');
          responseStream.write(`data: ${JSON.stringify({ 
            error: 'Request timeout',
            code: 'TIMEOUT',
            timestamp: new Date().toISOString()
          })}\n\n`);
          responseStream.end();
        }
        reject(new Error('Request timeout'));
      });

      // 处理客户端断开连接
      responseStream.on('close', () => {
        logger.debug('🔌 Client disconnected, cleaning up stream');
        if (!req.destroyed) {
          req.destroy();
        }
      });

      // 写入请求体
      req.write(JSON.stringify(body));
      req.end();
    });
  }

  // 🌊 发送流式请求到Claude API
  async _makeClaudeStreamRequest(body, accessToken, proxyAgent, clientHeaders, responseStream, requestOptions = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.claudeApiUrl);
      
      // 获取过滤后的客户端 headers
      const filteredHeaders = this._filterClientHeaders(clientHeaders);
      
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'anthropic-version': this.apiVersion,
          ...filteredHeaders
        },
        agent: proxyAgent,
        timeout: config.proxy.timeout
      };
      
      // 如果客户端没有提供 User-Agent，使用默认值
      if (!filteredHeaders['User-Agent'] && !filteredHeaders['user-agent']) {
        options.headers['User-Agent'] = 'claude-cli/1.0.53 (external, cli)';
      }

      // 使用自定义的 betaHeader 或默认值
      const betaHeader = requestOptions?.betaHeader !== undefined ? requestOptions.betaHeader : this.betaHeader;
      if (betaHeader) {
        options.headers['anthropic-beta'] = betaHeader;
      }

      const req = https.request(options, (res) => {
        // 设置响应头
        responseStream.statusCode = res.statusCode;
        Object.keys(res.headers).forEach(key => {
          responseStream.setHeader(key, res.headers[key]);
        });

        // 管道响应数据
        res.pipe(responseStream);
        
        res.on('end', () => {
          logger.debug('🌊 Claude stream response completed');
          resolve();
        });
      });

      req.on('error', (error) => {
        logger.error('❌ Claude stream request error:', error.message, {
          code: error.code,
          errno: error.errno,
          syscall: error.syscall
        });
        
        // 根据错误类型提供更具体的错误信息
        let errorMessage = 'Upstream request failed';
        let statusCode = 500;
        if (error.code === 'ECONNRESET') {
          errorMessage = 'Connection reset by Claude API server';
          statusCode = 502;
        } else if (error.code === 'ENOTFOUND') {
          errorMessage = 'Unable to resolve Claude API hostname';
          statusCode = 502;
        } else if (error.code === 'ECONNREFUSED') {
          errorMessage = 'Connection refused by Claude API server';
          statusCode = 502;
        } else if (error.code === 'ETIMEDOUT') {
          errorMessage = 'Connection timed out to Claude API server';
          statusCode = 504;
        }
        
        if (!responseStream.headersSent) {
          responseStream.writeHead(statusCode, { 
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
        }
        
        if (!responseStream.destroyed) {
          // 发送 SSE 错误事件
          responseStream.write('event: error\n');
          responseStream.write(`data: ${JSON.stringify({ 
            error: errorMessage,
            code: error.code,
            timestamp: new Date().toISOString()
          })}\n\n`);
          responseStream.end();
        }
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        logger.error('❌ Claude stream request timeout');
        if (!responseStream.headersSent) {
          responseStream.writeHead(504, { 
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
        }
        if (!responseStream.destroyed) {
          // 发送 SSE 错误事件
          responseStream.write('event: error\n');
          responseStream.write(`data: ${JSON.stringify({ 
            error: 'Request timeout',
            code: 'TIMEOUT',
            timestamp: new Date().toISOString()
          })}\n\n`);
          responseStream.end();
        }
        reject(new Error('Request timeout'));
      });

      // 处理客户端断开连接
      responseStream.on('close', () => {
        logger.debug('🔌 Client disconnected, cleaning up stream');
        if (!req.destroyed) {
          req.destroy();
        }
      });

      // 写入请求体
      req.write(JSON.stringify(body));
      req.end();
    });
  }

  // 🔄 重试逻辑
  async _retryRequest(requestFunc, maxRetries = 3) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await requestFunc();
      } catch (error) {
        lastError = error;
        
        if (i < maxRetries - 1) {
          const delay = Math.pow(2, i) * 1000; // 指数退避
          logger.warn(`⏳ Retry ${i + 1}/${maxRetries} in ${delay}ms: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  // 🎯 健康检查
  async healthCheck() {
    try {
      const accounts = await claudeAccountService.getAllAccounts();
      const activeAccounts = accounts.filter(acc => acc.isActive && acc.status === 'active');
      
      return {
        healthy: activeAccounts.length > 0,
        activeAccounts: activeAccounts.length,
        totalAccounts: accounts.length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ Health check failed:', error);
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // 🔄 根据API Key类型处理响应
  _processResponseByKeyType(response, keyType) {
    if (keyType === 'cc') {
      // Claude Code类型，需要减去14个input tokens
      const processedResponse = { ...response };
      
      // 处理响应体
      if (response.body) {
        try {
          const responseData = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
          const modifiedData = this._modifyResponseForClaudeCode(responseData);
          processedResponse.body = JSON.stringify(modifiedData);
        } catch (error) {
          logger.warn('⚠️ Failed to process response body for Claude Code format:', error.message);
        }
      }
      
      return processedResponse;
    }

    if (keyType === 'anthropic') {
      // Anthropic类型，处理逻辑同cc，但header要改成anthropic风格
      const processedResponse = { ...response };
      
      // 处理响应体（和CC一样减去14个input tokens）
      if (response.body) {
        try {
          const responseData = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
          const modifiedData = this._modifyResponseForClaudeCode(responseData);
          processedResponse.body = JSON.stringify(modifiedData);
        } catch (error) {
          logger.warn('⚠️ Failed to process response body for Anthropic format:', error.message);
        }
      }
      
      // 处理响应头（Anthropic风格）
      processedResponse.headers = this._modifyHeadersForKeyType(response.headers || {}, keyType, false);
      
      return processedResponse;
    }

    if (keyType === 'aws' || keyType === 'databricks') {
      // AWS和Databricks类型需要特殊处理
      const processedResponse = { ...response };
      let tokenCounts = {};
      
      // 处理响应体并提取token计数
      if (response.body) {
        try {
          const responseData = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
          const modifiedData = this._modifyResponseForBedrock(responseData, keyType);
          processedResponse.body = JSON.stringify(modifiedData);
          
          // 提取实际的token计数用于headers
          if (modifiedData.usage) {
            tokenCounts.input = modifiedData.usage.input_tokens;
            tokenCounts.output = modifiedData.usage.output_tokens;
          }
        } catch (error) {
          logger.warn('⚠️ Failed to process response body for bedrock format:', error.message);
        }
      }
      
      // 处理响应头（非流式）
      processedResponse.headers = this._modifyHeadersForKeyType(response.headers || {}, keyType, false, tokenCounts);
      
      return processedResponse;
    }

    return response;
  }

  // 🛠️ 修改响应数据为Bedrock格式
  _modifyResponseForBedrock(data, keyType = 'aws') {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const modifiedData = { ...data };

    // 修改消息ID，在原ID基础上添加bdrk标识
    if (modifiedData.id && typeof modifiedData.id === 'string') {
      // 如果ID格式是 msg_xxx，在msg_后添加bdrk_
      if (modifiedData.id.startsWith('msg_')) {
        modifiedData.id = modifiedData.id.replace('msg_', 'msg_bdrk_');
      }
    }

    // 修改message对象中的ID（用于流式响应的message_start事件）
    if (modifiedData.message && modifiedData.message.id && typeof modifiedData.message.id === 'string') {
      if (modifiedData.message.id.startsWith('msg_')) {
        modifiedData.message.id = modifiedData.message.id.replace('msg_', 'msg_bdrk_');
      }
    }

    // 处理content数组中的tool_use类型
    if (modifiedData.content && Array.isArray(modifiedData.content)) {
      modifiedData.content = modifiedData.content.map(item => {
        if (item.type === 'tool_use' && item.id && typeof item.id === 'string') {
          // 如果ID格式是 toolu_xxx，在toolu_后添加bdrk_
          if (item.id.startsWith('toolu_')) {
            return {
              ...item,
              id: item.id.replace('toolu_', 'toolu_bdrk_')
            };
          }
        }
        return item;
      });
    }

    // 处理content_block中的tool_use（用于流式响应的content_block_start事件）
    if (modifiedData.content_block && modifiedData.content_block.type === 'tool_use' && 
        modifiedData.content_block.id && typeof modifiedData.content_block.id === 'string') {
      if (modifiedData.content_block.id.startsWith('toolu_')) {
        modifiedData.content_block = {
          ...modifiedData.content_block,
          id: modifiedData.content_block.id.replace('toolu_', 'toolu_bdrk_')
        };
      }
    }

    // 修改usage字段
    if (modifiedData.usage && typeof modifiedData.usage === 'object') {
      const originalInputTokens = modifiedData.usage.input_tokens || 0;
      const originalCacheRead = modifiedData.usage.cache_read_input_tokens || 0;
      const originalCacheCreation = modifiedData.usage.cache_creation_input_tokens || 0;
      
      if (keyType === 'aws') {
        // AWS类型：保留cache tokens不清零，所有input_tokens都要减14
        modifiedData.usage = {
          ...modifiedData.usage,
          cache_creation_input_tokens: originalCacheCreation,
          cache_read_input_tokens: originalCacheRead,
          input_tokens: originalInputTokens > 14 ? originalInputTokens - 14 : originalInputTokens
        };
      } else if (keyType === 'databricks') {
        // Databricks类型：input_tokens = input + cache_read + cache_creation - 14，然后清零cache
        const totalInputTokens = originalInputTokens + originalCacheRead + originalCacheCreation;
        modifiedData.usage = {
          ...modifiedData.usage,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          input_tokens: totalInputTokens > 14 ? totalInputTokens - 14 : totalInputTokens
        };
      } else {
        // 其他类型(cc, anthropic等)：input_tokens都要减14
        modifiedData.usage = {
          ...modifiedData.usage,
          input_tokens: originalInputTokens > 14 ? originalInputTokens - 14 : originalInputTokens
        };
      }
    }

    // 处理message对象中的usage（用于流式响应）
    if (modifiedData.message && modifiedData.message.usage && typeof modifiedData.message.usage === 'object') {
      const originalInputTokens = modifiedData.message.usage.input_tokens || 0;
      const originalCacheRead = modifiedData.message.usage.cache_read_input_tokens || 0;
      const originalCacheCreation = modifiedData.message.usage.cache_creation_input_tokens || 0;
      
      if (keyType === 'aws') {
        // AWS类型：保留cache tokens不清零，所有input_tokens都要减14
        modifiedData.message.usage = {
          ...modifiedData.message.usage,
          cache_creation_input_tokens: originalCacheCreation,
          cache_read_input_tokens: originalCacheRead,
          input_tokens: originalInputTokens > 14 ? originalInputTokens - 14 : originalInputTokens
        };
      } else if (keyType === 'databricks') {
        // Databricks类型：input_tokens = input + cache_read + cache_creation - 14，然后清零cache
        const totalInputTokens = originalInputTokens + originalCacheRead + originalCacheCreation;
        modifiedData.message.usage = {
          ...modifiedData.message.usage,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          input_tokens: totalInputTokens > 14 ? totalInputTokens - 14 : totalInputTokens
        };
      } else {
        // 其他类型(cc, anthropic等)：input_tokens都要减14
        modifiedData.message.usage = {
          ...modifiedData.message.usage,
          input_tokens: originalInputTokens > 14 ? originalInputTokens - 14 : originalInputTokens
        };
      }
    }

    return modifiedData;
  }

  // 🛠️ 修改响应数据为Claude Code格式
  _modifyResponseForClaudeCode(data) {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const modifiedData = { ...data };

    // 修改usage字段，减去14个input tokens
    if (modifiedData.usage && typeof modifiedData.usage === 'object') {
      const originalInputTokens = modifiedData.usage.input_tokens || 0;
      modifiedData.usage = {
        ...modifiedData.usage,
        input_tokens: originalInputTokens > 14 ? originalInputTokens - 14 : originalInputTokens // 只有超过14个token时才减去
      };
    }

    // 处理message对象中的usage（用于流式响应）
    if (modifiedData.message && modifiedData.message.usage && typeof modifiedData.message.usage === 'object') {
      const originalInputTokens = modifiedData.message.usage.input_tokens || 0;
      modifiedData.message.usage = {
        ...modifiedData.message.usage,
        input_tokens: originalInputTokens > 14 ? originalInputTokens - 14 : originalInputTokens // 只有超过14个token时才减去
      };
    }

    return modifiedData;
  }

  // 🔧 修改响应头为指定Key类型格式
  _modifyHeadersForKeyType(originalHeaders, keyType, isStreaming = false, tokenCounts = {}) {
    if (keyType === 'aws') {
      // 生成随机latency（1000-3000ms）
      const randomLatency = Math.floor(Math.random() * 2000) + 1000;
      
      if (isStreaming) {
        // AWS 流式响应头 - 只保留指定的字段
        return {
          'x-amzn-requestid': this._generateAWSRequestId(),
          'x-amzn-bedrock-content-type': 'application/json',
          'content-type': 'text/event-stream',
          'date': new Date().toUTCString(),
          'connection': 'keep-alive'
        };
      } else {
        // AWS 非流式响应头 - 只保留指定的字段
        return {
          'x-amzn-requestid': this._generateAWSRequestId(),
          'x-amzn-bedrock-invocation-latency': randomLatency.toString(),
          'x-amzn-bedrock-output-token-count': (tokenCounts.output || this._generateRandomTokenCount(20, 100)).toString(),
          'x-amzn-bedrock-input-token-count': (tokenCounts.input || this._generateRandomTokenCount(5, 50)).toString(),
          'content-type': 'application/json',
          'date': new Date().toUTCString()
        };
      }
    }
    
    if (keyType === 'databricks') {
      // 生成随机latency（10000-20000ms 基于示例）
      const randomLatency = Math.floor(Math.random() * 10000) + 10000;
      
      if (isStreaming) {
        // Databricks 流式响应头
        return {
          'x-amzn-requestid': this._generateAWSRequestId(),
          'x-amzn-bedrock-content-type': 'application/json',
          'content-type': 'text/event-stream',
          'date': new Date().toUTCString(),
          'x-databricks-org-id': '94787086326342',
          'x-request-id': this._generateAWSRequestId(),
          'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
          'x-content-type-options': 'nosniff',
          'server': 'databricks',
          'alt-svc': 'clear',
          'transfer-encoding': 'chunked'
        };
      } else {
        // Databricks 非流式响应头
        return {
          'x-amzn-requestid': this._generateAWSRequestId(),
          'x-amzn-bedrock-invocation-latency': randomLatency.toString(),
          'x-amzn-bedrock-output-token-count': (tokenCounts.output || this._generateRandomTokenCount(500, 800)).toString(),
          'x-amzn-bedrock-input-token-count': (tokenCounts.input || this._generateRandomTokenCount(400, 700)).toString(),
          'content-type': 'application/json',
          'date': new Date().toUTCString(),
          'x-databricks-org-id': '94787086326342',
          'x-request-id': this._generateAWSRequestId(),
          'content-encoding': 'gzip',
          'vary': 'Accept-Encoding',
          'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
          'x-content-type-options': 'nosniff',
          'server': 'databricks',
          'alt-svc': 'clear',
          'transfer-encoding': 'chunked'
        };
      }
    }
    
    if (keyType === 'anthropic') {
      if (isStreaming) {
        // Anthropic 流式响应头
        return {
          'date': new Date().toUTCString(),
          'content-type': 'text/event-stream; charset=utf-8',
          'transfer-encoding': 'chunked',
          'connection': 'keep-alive',
          'cache-control': 'no-cache',
          'anthropic-ratelimit-input-tokens-limit': '30000',
          'anthropic-ratelimit-input-tokens-remaining': '30000',
          'anthropic-ratelimit-input-tokens-reset': new Date().toISOString(),
          'anthropic-ratelimit-output-tokens-limit': '8000',
          'anthropic-ratelimit-output-tokens-remaining': '8000',
          'anthropic-ratelimit-output-tokens-reset': new Date().toISOString(),
          'anthropic-ratelimit-requests-limit': '50',
          'anthropic-ratelimit-requests-remaining': '49',
          'anthropic-ratelimit-requests-reset': new Date().toISOString(),
          'anthropic-ratelimit-tokens-limit': '38000',
          'anthropic-ratelimit-tokens-remaining': '38000',
          'anthropic-ratelimit-tokens-reset': new Date().toISOString(),
          'request-id': this._generateAnthropicRequestId(),
          'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
          'anthropic-organization-id': 'ae196e19-b2d3-46db-9523-72dafb2b48a7',
          'via': '1.1 google',
          'cf-cache-status': 'DYNAMIC',
          'x-robots-tag': 'none',
          'server': 'cloudflare',
          'cf-ray': this._generateCFRay()
        };
      } else {
        // Anthropic 非流式响应头
        return {
          'date': new Date().toUTCString(),
          'content-type': 'application/json',
          'transfer-encoding': 'chunked',
          'connection': 'keep-alive',
          'anthropic-ratelimit-input-tokens-limit': '30000',
          'anthropic-ratelimit-input-tokens-remaining': '30000',
          'anthropic-ratelimit-input-tokens-reset': new Date().toISOString(),
          'anthropic-ratelimit-output-tokens-limit': '8000',
          'anthropic-ratelimit-output-tokens-remaining': '8000',
          'anthropic-ratelimit-output-tokens-reset': new Date().toISOString(),
          'anthropic-ratelimit-requests-limit': '50',
          'anthropic-ratelimit-requests-remaining': '49',
          'anthropic-ratelimit-requests-reset': new Date().toISOString(),
          'anthropic-ratelimit-tokens-limit': '38000',
          'anthropic-ratelimit-tokens-remaining': '38000',
          'anthropic-ratelimit-tokens-reset': new Date().toISOString(),
          'request-id': this._generateAnthropicRequestId(),
          'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
          'anthropic-organization-id': 'ae196e19-b2d3-46db-9523-72dafb2b48a7',
          'via': '1.1 google',
          'cf-cache-status': 'DYNAMIC',
          'x-robots-tag': 'none',
          'server': 'cloudflare',
          'cf-ray': this._generateCFRay(),
          'content-encoding': 'gzip'
        };
      }
    }
    
    return originalHeaders;
  }

  // 🌊 处理流式数据为Bedrock格式
  _processStreamDataForBedrock(sseData, keyType = 'aws') {
    if (!sseData || typeof sseData !== 'string') {
      return sseData;
    }

    try {
      const lines = sseData.split('\n');
      const processedLines = lines.map(line => {
        if (line.startsWith('data: ') && line.length > 6) {
          try {
            const jsonStr = line.slice(6);
            if (jsonStr.trim() === '[DONE]' || jsonStr.trim() === '') {
              return line; // 保持特殊标记不变
            }
            
            const data = JSON.parse(jsonStr);
            const modifiedData = this._modifyResponseForBedrock(data, keyType);
            return `data: ${JSON.stringify(modifiedData)}`;
          } catch (e) {
            // JSON解析失败，返回原始行
            return line;
          }
        }
        return line; // 非data行保持不变
      });
      
      return processedLines.join('\n');
    } catch (error) {
      logger.warn('⚠️ Failed to process stream data for bedrock format:', error.message);
      return sseData; // 处理失败，返回原始数据
    }
  }

  // 🌊 处理流式数据为Claude Code格式
  _processStreamDataForClaudeCode(sseData) {
    if (!sseData || typeof sseData !== 'string') {
      return sseData;
    }

    try {
      const lines = sseData.split('\n');
      const processedLines = lines.map(line => {
        if (line.startsWith('data: ') && line.length > 6) {
          try {
            const jsonStr = line.slice(6);
            if (jsonStr.trim() === '[DONE]' || jsonStr.trim() === '') {
              return line; // 保持特殊标记不变
            }
            
            const data = JSON.parse(jsonStr);
            const modifiedData = this._modifyResponseForClaudeCode(data);
            return `data: ${JSON.stringify(modifiedData)}`;
          } catch (e) {
            // JSON解析失败，返回原始行
            return line;
          }
        }
        return line; // 非data行保持不变
      });
      
      return processedLines.join('\n');
    } catch (error) {
      logger.warn('⚠️ Failed to process stream data for Claude Code format:', error.message);
      return sseData; // 处理失败，返回原始数据
    }
  }

  // 🔢 生成请求ID
  _generateRequestId() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // 🆔 生成AWS风格的请求ID
  _generateAWSRequestId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const segments = [8, 4, 4, 4, 12]; // UUID格式: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    let result = '';
    
    for (let i = 0; i < segments.length; i++) {
      if (i > 0) result += '-';
      for (let j = 0; j < segments[i]; j++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    }
    
    return result;
  }

  // 🔢 生成随机token数量
  _generateRandomTokenCount(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // 🔧 生成Anthropic风格的请求ID
  _generateAnthropicRequestId() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'req_';
    for (let i = 0; i < 24; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // 🔧 生成CF-RAY
  _generateCFRay() {
    const chars = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < 16; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    result += '-MCI';
    return result;
  }
}

module.exports = new ClaudeRelayService();