const https = require('https');
const zlib = require('zlib');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const claudeAccountService = require('./claudeAccountService');
const logger = require('../utils/logger');
const config = require('../../config/config');

class TokenCountService {
  constructor() {
    this.claudeApiUrl = config.claude.apiUrl;
    this.apiVersion = config.claude.apiVersion;
  }

  /**
   * 计算 Claude API 请求的输入 token 数量
   * @param {Object} requestBody - Claude API 请求体
   * @param {string} accountId - Claude 账户ID (用于获取代理配置)
   * @returns {Promise<number>} token 数量
   */
  async countInputTokens(requestBody, accountId) {
    try {
      // 获取访问token
      const accessToken = await claudeAccountService.getValidAccessToken(accountId);
      
      // 获取代理配置
      const proxyAgent = await this._getProxyAgent(accountId);
      
      // 构建 token 计算请求体
      const countRequestBody = {
        model: requestBody.model,
        messages: requestBody.messages
      };
      
      // 添加可选字段
      if (requestBody.system) {
        countRequestBody.system = requestBody.system;
      }
      if (requestBody.tools) {
        countRequestBody.tools = requestBody.tools;
      }
      
      // 发送到 Claude Token Count API
      const response = await this._makeTokenCountRequest(countRequestBody, accessToken, proxyAgent);
      
      return response.input_tokens || 0;
    } catch (error) {
      logger.error('❌ Token count calculation failed:', {
        error: error.message,
        requestModel: requestBody?.model,
        accountId
      });
      
      // 如果 token 计算失败，返回一个估计值 (避免阻塞请求)
      return this._estimateTokenCount(requestBody);
    }
  }

  /**
   * 发送 token 计算请求到 Claude API
   * @param {Object} requestBody - token 计算请求体
   * @param {string} accessToken - 访问token
   * @param {Object} proxyAgent - 代理配置
   * @returns {Promise<Object>} token 计算响应
   */
  async _makeTokenCountRequest(requestBody, accessToken, proxyAgent) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(requestBody);
      
      const options = {
        hostname: 'api.anthropic.com',
        port: 443,
        path: '/v1/messages/count_tokens',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'Authorization': `Bearer ${accessToken}`,
          'anthropic-version': this.apiVersion,
          'User-Agent': 'Claude-Relay-Service/1.0',
          'Accept-Encoding': 'gzip, deflate'
        },
        timeout: 10000 // 10秒超时
      };

      // 设置代理
      if (proxyAgent) {
        options.agent = proxyAgent;
      }

      const req = https.request(options, (res) => {
        let responseBody = '';
        let stream = res;
        
        // 处理gzip压缩
        if (res.headers['content-encoding'] === 'gzip') {
          stream = zlib.createGunzip();
          res.pipe(stream);
        } else if (res.headers['content-encoding'] === 'deflate') {
          stream = zlib.createInflate();
          res.pipe(stream);
        }

        stream.on('data', (chunk) => {
          responseBody += chunk.toString();
        });

        stream.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const data = JSON.parse(responseBody);
              logger.debug('✅ Token count successful:', {
                inputTokens: data.input_tokens,
                model: requestBody.model
              });
              resolve(data);
            } else {
              logger.warn('⚠️ Token count API non-200 response:', {
                statusCode: res.statusCode,
                response: responseBody,
                model: requestBody.model
              });
              reject(new Error(`Token count API error: ${res.statusCode}`));
            }
          } catch (parseError) {
            logger.error('❌ Failed to parse token count response:', parseError);
            reject(parseError);
          }
        });
      });

      req.on('error', (error) => {
        logger.error('❌ Token count request error:', error);
        reject(error);
      });

      req.on('timeout', () => {
        logger.warn('⏰ Token count request timeout');
        req.destroy();
        reject(new Error('Token count request timeout'));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * 获取代理配置
   * @param {string} accountId - Claude 账户ID
   * @returns {Promise<Object|null>} 代理Agent对象
   */
  async _getProxyAgent(accountId) {
    try {
      const account = await claudeAccountService.getAccount(accountId);
      if (!account || !account.proxy || !account.proxy.enabled) {
        return null;
      }

      const proxy = account.proxy;
      const auth = proxy.username && proxy.password ? 
        `${proxy.username}:${proxy.password}@` : '';
      
      if (proxy.type === 'socks5') {
        const proxyUrl = `socks5://${auth}${proxy.host}:${proxy.port}`;
        return new SocksProxyAgent(proxyUrl);
      } else if (proxy.type === 'http') {
        const proxyUrl = `http://${auth}${proxy.host}:${proxy.port}`;
        return new HttpsProxyAgent(proxyUrl);
      }
      
      return null;
    } catch (error) {
      logger.warn('⚠️ Failed to get proxy configuration:', error);
      return null;
    }
  }

  /**
   * 估算 token 数量 (fallback 方法)
   * @param {Object} requestBody - 请求体
   * @returns {number} 估算的 token 数量
   */
  _estimateTokenCount(requestBody) {
    try {
      let totalChars = 0;
      
      // 计算 messages 的字符数
      if (requestBody.messages && Array.isArray(requestBody.messages)) {
        for (const message of requestBody.messages) {
          if (message.content) {
            if (typeof message.content === 'string') {
              totalChars += message.content.length;
            } else if (Array.isArray(message.content)) {
              for (const content of message.content) {
                if (content.type === 'text' && content.text) {
                  totalChars += content.text.length;
                }
              }
            }
          }
        }
      }
      
      // 计算 system prompt 的字符数
      if (requestBody.system) {
        if (typeof requestBody.system === 'string') {
          totalChars += requestBody.system.length;
        } else if (Array.isArray(requestBody.system)) {
          for (const item of requestBody.system) {
            if (item.type === 'text' && item.text) {
              totalChars += item.text.length;
            }
          }
        }
      }
      
      // 粗略估算: 1 token ≈ 4 个字符 (英文)，为了安全起见使用 3.5
      const estimatedTokens = Math.ceil(totalChars / 3.5);
      
      logger.warn('⚠️ Using estimated token count:', {
        totalChars,
        estimatedTokens,
        model: requestBody.model
      });
      
      return estimatedTokens;
    } catch (error) {
      logger.error('❌ Token estimation failed:', error);
      // 返回一个保守的估计值
      return 500;
    }
  }
}

module.exports = new TokenCountService();