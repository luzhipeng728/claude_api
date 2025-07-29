// 临时脚本：创建测试Claude账户
const redis = require('./src/models/redis');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

async function createTestAccount() {
  try {
    const accountId = uuidv4();
    
    // 创建一个mock的Claude账户
    const accountData = {
      id: accountId,
      name: 'Test Account',
      description: 'Test account for API key testing',
      email: 'test@example.com',
      isActive: true,
      accountType: 'shared',
      proxy: null,
      claudeAiOauth: {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: Date.now() + 3600000, // 1小时后过期
        scopes: ['anthropic:manage']
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // 加密敏感数据
    const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'CHANGE-THIS-32-CHARACTER-KEY-NOW';
    if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 32) {
      throw new Error('Invalid ENCRYPTION_KEY: ' + ENCRYPTION_KEY);
    }

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', ENCRYPTION_KEY);
    let encrypted = cipher.update(JSON.stringify(accountData.claudeAiOauth), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    accountData.claudeAiOauth = {
      encrypted: encrypted,
      iv: iv.toString('hex')
    };

    // 保存到Redis
    await redis.hset(`claude_account:${accountId}`, accountData);
    
    console.log('✅ Test Claude account created successfully');
    console.log('Account ID:', accountId);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating test account:', error);
    process.exit(1);
  }
}

createTestAccount();