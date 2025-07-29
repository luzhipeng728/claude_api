#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * 🛠️ 本地开发环境设置脚本
 * 自动配置本地调试环境，避免影响生产环境
 */

console.log('🚀 设置本地开发环境...\n');

// 1. 检查.env.local是否存在
const envLocalPath = path.join(__dirname, '..', '.env.local');
if (!fs.existsSync(envLocalPath)) {
  console.error('❌ .env.local 文件不存在，请先创建该文件');
  process.exit(1);
}

// 2. 创建开发专用日志目录
const devLogsDir = path.join(__dirname, '..', 'logs-dev');
if (!fs.existsSync(devLogsDir)) {
  fs.mkdirSync(devLogsDir, { recursive: true });
  console.log('📁 创建开发日志目录: logs-dev/');
}

// 3. 创建开发专用初始化文件
const devDataDir = path.join(__dirname, '..', 'data-dev');
if (!fs.existsSync(devDataDir)) {
  fs.mkdirSync(devDataDir, { recursive: true });
  console.log('📁 创建开发数据目录: data-dev/');
}

// 复制初始化数据文件
const originalInit = path.join(__dirname, '..', 'data', 'init.json');
const devInit = path.join(devDataDir, 'init.json');
if (fs.existsSync(originalInit) && !fs.existsSync(devInit)) {
  const initData = JSON.parse(fs.readFileSync(originalInit, 'utf8'));
  // 修改开发环境专用的管理员信息
  initData.admin.username = 'dev_admin';
  initData.admin.password = 'dev123456';
  fs.writeFileSync(devInit, JSON.stringify(initData, null, 2));
  console.log('📋 创建开发环境初始化文件');
}

// 4. 检查Docker是否运行
try {
  execSync('docker --version', { stdio: 'pipe' });
  console.log('✅ Docker 已安装');
} catch (error) {
  console.warn('⚠️ Docker 未安装或未运行，将跳过容器启动');
}

// 5. 显示使用说明
console.log('\n🎯 本地开发环境设置完成！\n');
console.log('📚 使用说明：');
console.log('1. 启动开发专用Redis：npm run dev:redis');
console.log('2. 启动本地调试服务：npm run dev:local');
console.log('3. 或直接启动完整环境：npm run dev:full');
console.log('4. 访问Redis管理界面：npm run dev:tools (http://localhost:8081)');
console.log('5. 停止开发环境：npm run dev:redis:stop\n');

console.log('🔍 调试端点：');
console.log('- 主服务：http://localhost:3001');
console.log('- Web管理：http://localhost:3001/web');
console.log('- 健康检查：http://localhost:3001/health');
console.log('- Redis管理：http://localhost:8081 (用户名:admin 密码:dev123)\n');

console.log('⚠️ 注意事项：');
console.log('- 开发环境使用独立的Redis实例（端口6380）');
console.log('- 数据不会持久化，重启后清空');
console.log('- 不会影响生产环境的redis_data目录');
console.log('- 开发日志保存在logs-dev目录');
console.log('- API Key前缀为"dev_"以区分环境\n');

console.log('🚀 准备开始开发！');