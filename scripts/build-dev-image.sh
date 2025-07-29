#!/bin/bash

# 🛠️ 构建开发环境镜像脚本
# 与生产环境完全隔离，不影响原有配置

set -e

echo "🚀 构建 Claude Relay Service 开发环境镜像..."

# 检查是否存在 .env.local
if [ ! -f ".env.local" ]; then
    echo "❌ .env.local 文件不存在，请先创建"
    exit 1
fi

# 构建开发镜像（使用不同的标签）
echo "🔨 构建开发镜像..."
docker build -f Dockerfile.local -t claude-relay-service:dev .

echo "✅ 开发镜像构建完成！"
echo ""
echo "🎯 可用命令："
echo "1. 启动开发环境（完整）：docker-compose -f docker-compose.local.yml up -d"
echo "2. 仅启动开发Redis：docker-compose -f docker-compose.local.yml up redis-dev -d"
echo "3. 启动带监控工具：docker-compose -f docker-compose.local.yml --profile tools up -d"
echo ""
echo "📊 镜像信息："
docker images | grep claude-relay-service
echo ""
echo "⚠️ 注意：开发环境使用独立的Redis实例和配置，不会影响生产环境"