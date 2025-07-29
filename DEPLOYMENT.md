# 🚀 Claude Relay Service 部署指南

## 📦 部署包内容

本部署包包含以下功能增强：

✅ **API Key 类型支持**: cc (Claude Code), aws (AWS Bedrock), databricks (Databricks)
✅ **响应转换**: AWS/Databricks keys 自动转换消息ID和usage字段
✅ **Token 限制检查**: AWS/Databricks keys 最小250 tokens要求
✅ **输入Token调整**: AWS/Databricks keys 的 input_tokens 自动减14

## 🐳 Docker 部署 (推荐)

### 1. 环境准备

```bash
# 解压部署包
unzip claude-relay-service-deploy.zip
cd claude-relay-service

# 复制生产环境配置
cp .env.production .env

# 编辑配置文件 (必须修改安全密钥)
nano .env
```

### 2. 必须修改的配置

在 `.env` 文件中修改以下配置：

```bash
# 🔐 安全配置 (必须修改!)
JWT_SECRET=your-jwt-secret-at-least-32-characters-long-random-string
ENCRYPTION_KEY=your-32-character-encryption-key-abcd
```

生成随机密钥的方法：
```bash
# JWT_SECRET (至少32字符)
openssl rand -hex 32

# ENCRYPTION_KEY (必须32字符)
openssl rand -hex 16
```

### 3. 启动服务

```bash
# 基础服务 (推荐)
docker-compose up -d

# 带监控服务
docker-compose --profile monitoring up -d
```

### 4. 验证部署

```bash
# 检查服务状态
docker-compose ps

# 查看日志
docker-compose logs -f claude-relay

# 健康检查
curl http://localhost:3000/health

# 访问管理界面
# http://localhost:3000/web
```

## 🔧 手动部署

### 1. 环境要求

- Node.js 18+
- Redis 6+
- PM2 (可选)

### 2. 安装和配置

```bash
# 安装依赖
npm install

# 复制配置文件
cp config/config.example.js config/config.js
cp .env.production .env

# 编辑配置 (修改JWT_SECRET和ENCRYPTION_KEY)
nano .env

# 初始化管理员
npm run setup
```

### 3. 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm start

# 后台运行 (PM2)
npm run service:start:daemon
```

## 🎯 API Key 类型测试

### 创建不同类型的 API Key

通过管理界面 (http://localhost:3000/web) 创建：

1. **Claude Code (cc)**: 标准类型，无特殊限制
2. **AWS Bedrock (aws)**: 最小250 tokens，响应格式转换
3. **Databricks (databricks)**: 最小250 tokens，响应格式转换

### 测试 API Key 功能

```bash
# 测试 Claude Code key (无限制)
curl -X POST "http://localhost:3000/api/v1/messages" \
  -H "Content-Type: application/json" \
  -H "authorization: Bearer cr_your_cc_key" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Hi"}],
    "max_tokens": 10
  }'

# 测试 AWS key (小于250 tokens，应该返回429)
curl -X POST "http://localhost:3000/api/v1/messages" \
  -H "Content-Type: application/json" \
  -H "authorization: Bearer cr_your_aws_key" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Hi"}],
    "max_tokens": 10
  }'

# 测试 AWS key (大于250 tokens，应该成功并转换响应)
curl -X POST "http://localhost:3000/api/v1/messages" \
  -H "Content-Type: application/json" \
  -H "authorization: Bearer cr_your_aws_key" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "请详细解释机器学习的基本概念..."}],
    "max_tokens": 50
  }'
```

## 📊 监控配置

启用监控服务：

```bash
docker-compose --profile monitoring up -d
```

访问地址：
- **Redis Commander**: http://localhost:8081
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001 (admin/admin123)

## 🔐 安全建议

1. **定期更新密钥**: JWT_SECRET 和 ENCRYPTION_KEY
2. **使用HTTPS**: 在生产环境中配置SSL证书
3. **防火墙配置**: 只开放必要端口 (3000)
4. **日志监控**: 定期检查安全日志
5. **备份策略**: 定期备份Redis数据和配置

## 🆘 故障排除

### 常见问题

1. **服务无法启动**
   ```bash
   docker-compose logs claude-relay
   ```

2. **Redis连接失败**
   ```bash
   docker-compose logs redis
   ```

3. **权限问题**
   ```bash
   sudo chown -R 1000:1000 ./logs ./data
   ```

4. **端口冲突**
   ```bash
   # 修改 .env 中的端口配置
   PORT=3001
   ```

### 日志位置

- **Docker日志**: `docker-compose logs`
- **应用日志**: `./logs/` 目录
- **Redis数据**: `./redis_data/` 目录

## 📞 技术支持

如遇到问题，请提供：
1. 错误日志
2. 配置文件 (隐藏敏感信息)
3. 系统环境信息
4. 重现步骤

---

## 🎉 功能特性

### API Key 类型增强

- **cc (Claude Code)**: 原生Claude API体验
- **aws (AWS Bedrock)**: 
  - 最小250 input tokens检查
  - 消息ID: `msg_xxx` → `msg_bdrk_xxx`
  - input_tokens 自动减14
  - AWS风格响应headers
- **databricks (Databricks)**:
  - 最小250 input tokens检查  
  - 消息ID: `msg_xxx` → `msg_bdrk_xxx`
  - input_tokens 自动减14
  - Databricks风格响应headers

### 智能Token计算

- 集成官方Anthropic Token Count API
- 智能回退机制 (字符估算)
- 支持代理环境
- 流式和非流式请求支持

部署愉快！🚀