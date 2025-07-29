# API Key 类型测试命令

测试三种不同类型的API Key：Claude Code (cc)、AWS Bedrock (aws)、Databricks (databricks)

## API Keys
- **Claude Code**: `cr_b15b7e119af04df9f6ed0883938bbe0a35f882e53a336223fdade097a3f6c4c4`
- **AWS Bedrock**: `cr_2be490a9324a4e6e6a68490d9edc21f5ba03c20b2b0bbd9a770a31276ecafe29`
- **Databricks**: `cr_468e3d5bacc34d735dca0a938107f4d02a64d38f1f8c7ae1bcc3445440ec2bea`

## 测试请求数据
使用 `/Users/luzhipeng/Downloads/cc.json` 文件或简化版本

---

## 1. Claude Code 类型 (cc) - 流式请求

```bash
curl -i --location 'http://localhost:3000/api/v1/messages' \
  --header 'Accept: application/json' \
  --header 'anthropic-version: 2023-06-01' \
  --header 'authorization: Bearer cr_b15b7e119af04df9f6ed0883938bbe0a35f882e53a336223fdade097a3f6c4c4' \
  --header 'content-type: application/json' \
  --data '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Hello, what is 1+1? Keep it short."}],
    "max_tokens": 50,
    "stream": true
  }'
```

## 2. Claude Code 类型 (cc) - 非流式请求

```bash
curl -i --location 'http://localhost:3000/api/v1/messages' \
  --header 'Accept: application/json' \
  --header 'anthropic-version: 2023-06-01' \
  --header 'authorization: Bearer cr_b15b7e119af04df9f6ed0883938bbe0a35f882e53a336223fdade097a3f6c4c4' \
  --header 'content-type: application/json' \
  --data '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Hello, what is 1+1? Keep it short."}],
    "max_tokens": 50
  }'
```

## 3. AWS Bedrock 类型 (aws) - 流式请求

```bash
curl -i --location 'http://localhost:3000/api/v1/messages' \
  --header 'Accept: application/json' \
  --header 'anthropic-version: 2023-06-01' \
  --header 'authorization: Bearer cr_2be490a9324a4e6e6a68490d9edc21f5ba03c20b2b0bbd9a770a31276ecafe29' \
  --header 'content-type: application/json' \
  --data '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Hello, what is 1+1? Keep it short."}],
    "max_tokens": 50,
    "stream": true
  }'
```

## 4. AWS Bedrock 类型 (aws) - 非流式请求

```bash
curl -i --location 'http://localhost:3000/api/v1/messages' \
  --header 'Accept: application/json' \
  --header 'anthropic-version: 2023-06-01' \
  --header 'authorization: Bearer cr_2be490a9324a4e6e6a68490d9edc21f5ba03c20b2b0bbd9a770a31276ecafe29' \
  --header 'content-type: application/json' \
  --data '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Hello, what is 1+1? Keep it short."}],
    "max_tokens": 50
  }'
```

## 5. Databricks 类型 (databricks) - 流式请求

```bash
curl -i --location 'http://localhost:3000/api/v1/messages' \
  --header 'Accept: application/json' \
  --header 'anthropic-version: 2023-06-01' \
  --header 'authorization: Bearer cr_468e3d5bacc34d735dca0a938107f4d02a64d38f1f8c7ae1bcc3445440ec2bea' \
  --header 'content-type: application/json' \
  --data '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Hello, what is 1+1? Keep it short."}],
    "max_tokens": 50,
    "stream": true
  }'
```

## 6. Databricks 类型 (databricks) - 非流式请求

```bash
curl -i --location 'http://localhost:3000/api/v1/messages' \
  --header 'Accept: application/json' \
  --header 'anthropic-version: 2023-06-01' \
  --header 'authorization: Bearer cr_468e3d5bacc34d735dca0a938107f4d02a64d38f1f8c7ae1bcc3445440ec2bea' \
  --header 'content-type: application/json' \
  --data '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Hello, what is 1+1? Keep it short."}],
    "max_tokens": 50
  }'
```

---

## 使用 cc.json 文件的测试 (推荐)

如果你想使用 `/Users/luzhipeng/Downloads/cc.json` 文件：

### Claude Code 类型 + cc.json 文件

```bash
curl -i --location 'http://localhost:3000/api/v1/messages' \
  --header 'Accept: application/json' \
  --header 'anthropic-version: 2023-06-01' \
  --header 'authorization: Bearer cr_b15b7e119af04df9f6ed0883938bbe0a35f882e53a336223fdade097a3f6c4c4' \
  --header 'content-type: application/json' \
  --data-binary '@/Users/luzhipeng/Downloads/cc.json'
```

### AWS Bedrock 类型 + cc.json 文件

```bash
curl -i --location 'http://localhost:3000/api/v1/messages' \
  --header 'Accept: application/json' \
  --header 'anthropic-version: 2023-06-01' \
  --header 'authorization: Bearer cr_2be490a9324a4e6e6a68490d9edc21f5ba03c20b2b0bbd9a770a31276ecafe29' \
  --header 'content-type: application/json' \
  --data-binary '@/Users/luzhipeng/Downloads/cc.json'
```

### Databricks 类型 + cc.json 文件

```bash
curl -i --location 'http://localhost:3000/api/v1/messages' \
  --header 'Accept: application/json' \
  --header 'anthropic-version: 2023-06-01' \
  --header 'authorization: Bearer cr_468e3d5bacc34d735dca0a938107f4d02a64d38f1f8c7ae1bcc3445440ec2bea' \
  --header 'content-type: application/json' \
  --data-binary '@/Users/luzhipeng/Downloads/cc.json'
```

---

## 检查API Key信息的命令

检查每个key的类型和状态：

```bash
# Claude Code key
curl -s "http://localhost:3000/api/v1/key-info" \
  -H "authorization: Bearer cr_b15b7e119af04df9f6ed0883938bbe0a35f882e53a336223fdade097a3f6c4c4"

# AWS Bedrock key  
curl -s "http://localhost:3000/api/v1/key-info" \
  -H "authorization: Bearer cr_2be490a9324a4e6e6a68490d9edc21f5ba03c20b2b0bbd9a770a31276ecafe29"

# Databricks key
curl -s "http://localhost:3000/api/v1/key-info" \
  -H "authorization: Bearer cr_468e3d5bacc34d735dca0a938107f4d02a64d38f1f8c7ae1bcc3445440ec2bea"
```

---

## 预期结果差异

1. **Claude Code (cc)**: 标准格式响应，消息ID格式为 `msg_xxx`
2. **AWS Bedrock (aws)**: 
   - 消息ID添加前缀变为 `msg_bdrk_xxx`
   - usage中cache tokens设为0，input_tokens减少14
   - Headers替换为AWS风格
3. **Databricks (databricks)**: 
   - 消息ID添加前缀变为 `msg_bdrk_xxx`
   - usage中cache tokens设为0，input_tokens减少14  
   - Headers替换为Databricks风格

测试时注意观察这些差异！