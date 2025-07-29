# 🚀 Claude Relay Service 部署指南

## 📦 快速部署

只需要这两个文件就可以在任何服务器部署：

1. `docker-compose.deploy.yml` - Docker Compose 配置文件
2. `.env.deploy` - 环境变量配置文件（重命名为 `.env`）

## 🔧 部署步骤

### 1. 准备文件
```bash
# 下载部署文件到服务器
wget https://your-server/docker-compose.deploy.yml
wget https://your-server/.env.deploy

# 重命名环境变量文件
mv .env.deploy .env
```

### 2. 修改配置
编辑 `.env` 文件，**必须修改**以下关键配置：
```bash
# 🔐 安全配置（必须修改！）
JWT_SECRET=你的32字符以上的安全密钥
ENCRYPTION_KEY=你的32字符加密密钥（必须32位）

# 🌐 端口配置（可选修改）
EXTERNAL_PORT=9990
REDIS_EXTERNAL_PORT=6381
REDIS_WEB_PORT=8081
```

### 3. 启动服务
```bash
# 基础部署
docker-compose -f docker-compose.deploy.yml up -d

# 包含Redis管理工具
docker-compose -f docker-compose.deploy.yml --profile tools up -d
```

### 4. 验证部署
```bash
# 健康检查
curl http://localhost:9990/health

# 查看容器状态
docker-compose -f docker-compose.deploy.yml ps

# 查看日志
docker-compose -f docker-compose.deploy.yml logs -f claude-relay
```

## 🌐 访问地址

- **主服务**: http://服务器IP:9990
- **Web管理界面**: http://服务器IP:9990/web
- **API端点**: http://服务器IP:9990/api/v1/messages
- **健康检查**: http://服务器IP:9990/health
- **Redis管理** (如果启用): http://服务器IP:8081

## 🔧 管理命令

```bash
# 查看服务状态
docker-compose -f docker-compose.deploy.yml ps

# 查看日志
docker-compose -f docker-compose.deploy.yml logs -f

# 重启服务
docker-compose -f docker-compose.deploy.yml restart

# 停止服务
docker-compose -f docker-compose.deploy.yml down

# 更新镜像
docker-compose -f docker-compose.deploy.yml pull
docker-compose -f docker-compose.deploy.yml up -d

# 完全清理（包括数据）
docker-compose -f docker-compose.deploy.yml down -v
```

## 🚀 性能优化特性

该镜像包含以下性能优化：

- ⚡ **API Key验证缓存**: 5分钟缓存，提升验证速度
- 🔄 **请求去重**: 防止重复请求（默认关闭）
- 📦 **智能压缩**: 自动压缩响应内容
- 🧹 **批量处理**: 优化数据库操作（默认关闭）
- 📊 **性能监控**: 实时性能指标
- 🔧 **连接池优化**: Redis连接池优化

## ⚙️ 配置说明

### 端口配置
- `EXTERNAL_PORT=9990` - 主服务端口
- `REDIS_EXTERNAL_PORT=6381` - Redis端口
- `REDIS_WEB_PORT=8081` - Redis管理界面端口

### 安全配置
- `JWT_SECRET` - JWT密钥（必须32字符以上）
- `ENCRYPTION_KEY` - 数据加密密钥（必须32字符）
- `API_KEY_PREFIX=cr_` - API Key前缀

### 性能配置
- `API_KEY_CACHE_ENABLED=true` - 启用API Key缓存
- `COMPRESSION_ENABLED=true` - 启用响应压缩
- `REDIS_POOL_MAX=20` - Redis连接池大小

## 🔍 故障排除

### 常见问题

1. **服务无法启动**
   ```bash
   # 检查配置文件
   docker-compose -f docker-compose.deploy.yml config
   
   # 查看详细日志
   docker-compose -f docker-compose.deploy.yml logs claude-relay
   ```

2. **Redis连接失败**
   ```bash
   # 检查Redis状态
   docker-compose -f docker-compose.deploy.yml logs redis-deploy
   
   # 测试Redis连接
   docker exec -it redis-deploy redis-cli ping
   ```

3. **外部无法访问**
   ```bash
   # 检查防火墙
   ufw allow 9990
   
   # 检查端口监听
   netstat -tlnp | grep 9990
   ```

## 🔄 更新部署

```bash
# 拉取最新镜像
docker-compose -f docker-compose.deploy.yml pull

# 重启服务应用更新
docker-compose -f docker-compose.deploy.yml up -d

# 清理旧镜像
docker image prune -f
```

## 📊 监控

健康检查端点返回详细的系统状态：
```json
{
  "status": "healthy",
  "service": "claude-relay-service", 
  "uptime": 123.45,
  "memory": {...},
  "components": {
    "redis": {"status": "healthy"},
    "logger": {"status": "healthy"}
  }
}
```

## 🆘 支持

如有问题，请检查：
1. 环境变量配置是否正确
2. 端口是否被占用
3. Docker和Docker Compose版本
4. 服务器防火墙设置