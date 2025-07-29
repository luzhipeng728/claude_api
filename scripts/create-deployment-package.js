#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 创建 Claude Relay Service 部署包...\n');

const projectRoot = path.resolve(__dirname, '..');
const packageName = 'claude-relay-service-deploy.zip';
const tempDir = path.join(projectRoot, 'temp-deploy');

try {
  // 读取 .gitignore 文件
  const gitignorePath = path.join(projectRoot, '.gitignore');
  let gitignorePatterns = [];
  
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    gitignorePatterns = gitignoreContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(pattern => {
        // 转换 gitignore 模式为 zip 排除模式
        if (pattern.endsWith('/')) {
          return pattern + '*';
        }
        return pattern;
      });
  }

  // 添加额外的排除模式
  const additionalExcludes = [
    '*.zip',
    'temp-deploy',
    'temp-deploy/*',
    '*.tar.gz',
    '*.bak',
    'claude-relay-service.pid',
    'package-lock.json.bak',
    '.git',
    '.git/*'
  ];

  gitignorePatterns.push(...additionalExcludes);

  console.log('📋 排除的文件和目录:');
  gitignorePatterns.forEach(pattern => {
    console.log(`   ❌ ${pattern}`);
  });
  console.log('');

  // 构建 zip 排除参数
  const excludeArgs = gitignorePatterns
    .map(pattern => `-x "${pattern}"`)
    .join(' ');

  // 创建部署包
  console.log('📦 正在创建部署包...');
  
  const zipCommand = `cd "${projectRoot}" && zip -r "${packageName}" . ${excludeArgs}`;
  execSync(zipCommand, { stdio: 'inherit' });

  // 获取文件大小
  const stats = fs.statSync(path.join(projectRoot, packageName));
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  console.log('');
  console.log('✅ 部署包创建成功!');
  console.log(`📁 文件名: ${packageName}`);
  console.log(`📊 文件大小: ${fileSizeMB} MB`);
  console.log(`📍 文件位置: ${path.join(projectRoot, packageName)}`);
  console.log('');

  // 显示包含的主要文件
  console.log('📋 包含的主要文件和目录:');
  const includedItems = [
    'src/',
    'config/',
    'scripts/', 
    'web/',
    'package.json',
    'Dockerfile',
    'docker-compose.yml',
    'docker-entrypoint.sh',
    '.env.production',
    'DEPLOYMENT.md',
    'README.md'
  ];

  includedItems.forEach(item => {
    const itemPath = path.join(projectRoot, item);
    if (fs.existsSync(itemPath)) {
      console.log(`   ✅ ${item}`);
    } else {
      console.log(`   ⚠️  ${item} (不存在)`);
    }
  });

  console.log('');
  console.log('🎯 部署指南:');
  console.log('1. 将 claude-relay-service-deploy.zip 上传到服务器');
  console.log('2. 解压: unzip claude-relay-service-deploy.zip');
  console.log('3. 配置: cp .env.production .env && nano .env');
  console.log('4. 部署: docker-compose up -d');
  console.log('5. 查看: DEPLOYMENT.md');
  console.log('');
  console.log('🚀 部署愉快!');

} catch (error) {
  console.error('❌ 创建部署包失败:', error.message);
  process.exit(1);
}