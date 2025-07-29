# 🚀 Claude Relay Service 部署前检查清单

## 📦 部署包验证

✅ **部署包已生成**: `claude-relay-service-deploy.zip` (3.83 MB)
✅ **自动排除**: 所有 .gitignore 中的文件已正确排除
✅ **Docker配置**: 修改为本地构建而非预构建镜像

## 🔧 核心功能确认

### ✅ API Key 类型支持
- **Claude Code (cc)**: 标准类型，无特殊限制
- **AWS Bedrock (aws)**: 最小250 tokens + 响应转换
- **Databricks (databricks)**: 最小250 tokens + 响应转换

### ✅ Token 计算和限制
- **Token Count Service**: 集成官方 Anthropic API
- **智能回退**: 字符估算机制
- **最小250 tokens**: AWS/Databricks keys 限制
- **429错误**: 正确的错误响应格式

### ✅ 响应转换功能
- **消息ID转换**: `msg_xxx` → `msg_bdrk_xxx`
- **input_tokens调整**: 自动减14 (AWS/Databricks)
- **Headers替换**: AWS/Databricks风格
- **cache tokens**: 设置为0 (AWS/Databricks)

### ✅ Docker部署支持
- **本地构建**: 不依赖预构建镜像
- **环境配置**: .env.production 模板
- **监控支持**: Redis, Prometheus, Grafana
- **健康检查**: 内置健康检查端点

## 🎯 部署验证步骤

### 1. 解压和配置
```bash
unzip claude-relay-service-deploy.zip
cd claude-relay-service
cp .env.production .env
```

### 2. 必须配置的安全密钥
```bash
# 生成随机密钥
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 16)

# 编辑 .env 文件
nano .env
```

### 3. Docker 构建和启动
```bash
# 基础服务
docker-compose up -d

# 带监控 (可选)
docker-compose --profile monitoring up -d
```

### 4. 功能验证

#### 健康检查
```bash
curl http://localhost:3000/health
# 期望: {"status":"healthy",...}
```

#### Web界面
```bash
# 访问管理界面
curl -I http://localhost:3000/web
# 期望: HTTP/1.1 200 OK
```

#### API Key类型测试
```bash
# 1. 创建不同类型的API Key (通过Web界面)
# 2. 测试Claude Code key (无限制)
curl -X POST "http://localhost:3000/api/v1/messages" \
  -H "authorization: Bearer cr_your_cc_key" \
  -d '{"model":"claude-sonnet-4-20250514","messages":[{"role":"user","content":"Hi"}],"max_tokens":10}'

# 3. 测试AWS key小请求 (应返回429)
curl -X POST "http://localhost:3000/api/v1/messages" \
  -H "authorization: Bearer cr_your_aws_key" \
  -d '{"model":"claude-sonnet-4-20250514","messages":[{"role":"user","content":"Hi"}],"max_tokens":10}'

# 4. 测试AWS key大请求 (应成功+转换)
curl -X POST "http://localhost:3000/api/v1/messages" \
  -H "authorization: Bearer cr_your_aws_key" \
  -d '{"model":"claude-sonnet-4-20250514","messages":[{"role":"user","content":"请详细解释机器学习的监督学习、无监督学习和强化学习的区别，并提供每种方法的具体应用场景和算法示例"}],"max_tokens":50}'
```

#### 预期结果验证
- **CC Key**: 正常响应，消息ID格式 `msg_xxx`
- **AWS Key (小)**: 429错误，包含token限制信息
- **AWS Key (大)**: 成功响应，消息ID格式 `msg_bdrk_xxx`，input_tokens减14

## 📊 日志监控

### 关键日志路径
```bash
# Docker 日志
docker-compose logs -f claude-relay

# 应用日志
tail -f ./logs/claude-relay-*.log

# 错误日志
tail -f ./logs/claude-relay-error-*.log
```

### 关键日志指标
- `📊 Token count for aws key: X tokens` - Token计算成功
- `🚦 Token limit check failed` - 限制检查工作
- `🔗 📊 Non-stream usage recorded` - 使用统计记录
- `msg_bdrk_` - 消息ID转换成功

## 🛡️ 安全配置检查

### 必须修改
- [ ] JWT_SECRET (至少32字符)
- [ ] ENCRYPTION_KEY (必须32字符)
- [ ] 管理员密码 (如果使用环境变量)

### 推荐配置
- [ ] 启用HTTPS (生产环境)
- [ ] 配置防火墙规则
- [ ] 设置日志轮转
- [ ] 配置备份策略

## 🚨 故障排除

### 常见问题和解决方案

1. **构建失败**: 检查Docker版本和磁盘空间
2. **服务无法启动**: 检查端口占用和权限
3. **Redis连接失败**: 检查Redis服务状态
4. **Token计算失败**: 检查代理配置和网络连接
5. **权限错误**: 设置正确的文件权限

### 快速诊断命令
```bash
# 检查容器状态
docker-compose ps

# 查看详细日志
docker-compose logs claude-relay

# 检查端口占用
netstat -tlnp | grep 3000

# 检查磁盘空间
df -h
```

## ✅ 部署完成确认

- [ ] 服务启动成功
- [ ] Web界面可访问
- [ ] 健康检查通过
- [ ] API Key功能正常
- [ ] Token限制工作
- [ ] 响应转换正确
- [ ] 日志记录正常
- [ ] 监控配置完成 (可选)

---

## 📞 技术支持

部署过程中如有问题，请提供：
1. 操作系统和Docker版本
2. 错误日志和截图
3. 配置文件内容 (隐藏敏感信息)
4. 网络环境信息

🎉 **恭喜！你的 Claude Relay Service 已准备好部署！**