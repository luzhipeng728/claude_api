# Claude Token管理和429处理可视化流程

## 🔄 OAuth Token自动刷新机制

```mermaid
graph TD
    A[客户端API请求] --> B[验证API Key]
    B --> C[选择Claude账户]
    C --> D[获取有效AccessToken]
    
    D --> E{检查Token过期?<br/>提前60秒判断}
    E -->|未过期| F[直接使用Token]
    E -->|过期/即将过期| G[尝试获取分布式锁]
    
    G --> H{获取锁成功?}
    H -->|失败| I[等待2秒<br/>获取更新后的数据]
    H -->|成功| J[开始刷新Token]
    
    J --> K[调用Anthropic OAuth API]
    K --> L{刷新成功?}
    L -->|成功| M[加密存储新Token<br/>更新过期时间]
    L -->|失败| N[标记账户错误状态<br/>记录错误日志]
    
    M --> O[释放分布式锁]
    N --> O
    I --> P[返回AccessToken]
    F --> P
    O --> P
    
    P --> Q[继续API请求]
    
    style G fill:#ffeb3b
    style K fill:#2196f3
    style M fill:#4caf50
    style N fill:#f44336
```

## 🚫 429 Rate Limit处理机制

```mermaid
graph TD
    A[发送API请求到Claude] --> B[接收API响应]
    
    B --> C{检查响应状态}
    C -->|200/201 成功| D[检查是否曾被限流]
    C -->|429 状态码| E[标记为限流]
    C -->|其他错误| F[解析错误消息]
    
    F --> G{错误消息包含<br/>'exceed rate limit'?}
    G -->|是| E
    G -->|否| H[处理其他错误]
    
    E --> I[markAccountRateLimited]
    I --> J[设置rateLimitedAt时间戳]
    J --> K[设置rateLimitStatus='limited']
    K --> L[更新Redis账户数据]
    L --> M{有粘性会话?}
    M -->|是| N[删除会话映射<br/>强制重新选择账户]
    M -->|否| O[记录限流日志]
    N --> O
    
    D --> P{账户曾被限流?}
    P -->|是| Q[removeAccountRateLimit<br/>恢复账户状态]
    P -->|否| R[继续正常处理]
    Q --> R
    
    style E fill:#f44336
    style I fill:#ff9800
    style Q fill:#4caf50
    style N fill:#9c27b0
```

## 🎯 智能账户选择策略

```mermaid
graph TD
    A[开始选择Claude账户] --> B{有专属绑定账户?}
    B -->|是| C[使用绑定账户]
    B -->|否| D[获取所有共享账户]
    
    D --> E[遍历检查限流状态]
    E --> F[分离限流/非限流账户]
    
    F --> G{有非限流账户?}
    G -->|是| H[按最后使用时间排序<br/>选择最久未用的]
    G -->|否| I[警告: 所有账户都被限流]
    
    I --> J[按限流时间排序<br/>选择最早被限流的]
    
    H --> K[建立会话映射]
    J --> L[建立会话映射<br/>可能接近恢复时间]
    
    K --> M[返回选中账户ID]
    L --> M
    C --> N{检查账户限流状态}
    N -->|限流| O[重新选择共享账户]
    N -->|正常| M
    O --> D
    
    style G fill:#4caf50
    style I fill:#ff9800
    style J fill:#ffeb3b
```

## ⏰ 自动恢复机制

```mermaid
graph TD
    A[每次账户操作] --> B[调用isAccountRateLimited]
    
    B --> C{账户有限流标记?}
    C -->|否| D[返回: 未限流]
    C -->|是| E[计算限流时长]
    
    E --> F{超过1小时?}
    F -->|否| G[返回: 仍在限流]
    F -->|是| H[自动解除限流]
    
    H --> I[删除rateLimitedAt时间戳]
    I --> J[删除rateLimitStatus标记]
    J --> K[更新Redis账户数据]
    K --> L[记录恢复日志]
    L --> M[返回: 已恢复]
    
    N[成功API请求] --> O[主动检查限流状态]
    O --> P{账户曾被限流?}
    P -->|是| Q[主动解除限流状态]
    P -->|否| R[继续正常流程]
    Q --> R
    
    style H fill:#4caf50
    style Q fill:#2196f3
    style F fill:#ffeb3b
```

## 📊 完整的请求处理流程

```mermaid
sequenceDiagram
    participant Client as 客户端
    participant Relay as Claude Relay Service
    participant Account as 账户管理器
    participant Redis as Redis存储
    participant Claude as Claude API
    
    Client->>Relay: API请求 (带自建API Key)
    Relay->>Account: 验证API Key并选择账户
    
    Account->>Redis: 检查账户限流状态
    Redis-->>Account: 返回限流信息
    
    alt 账户被限流
        Account->>Account: 选择其他可用账户
    end
    
    Account->>Redis: 获取账户Token信息
    Redis-->>Account: 返回加密的Token数据
    
    alt Token过期或即将过期
        Account->>Redis: 尝试获取刷新锁
        alt 获取锁成功
            Account->>Claude: OAuth Token刷新请求
            Claude-->>Account: 返回新Token
            Account->>Redis: 加密存储新Token
            Account->>Redis: 释放刷新锁
        else 锁被占用
            Account->>Account: 等待2秒
            Account->>Redis: 重新获取Token数据
        end
    end
    
    Account-->>Relay: 返回有效AccessToken
    Relay->>Claude: 转发API请求 (带OAuth Token)
    
    alt 收到429错误
        Claude-->>Relay: 429 Rate Limit响应
        Relay->>Account: 标记账户为限流状态
        Account->>Redis: 更新账户限流标记
        Account->>Redis: 删除粘性会话映射
        Relay-->>Client: 返回429错误
    else 请求成功
        Claude-->>Relay: 200 成功响应
        Relay->>Account: 检查并解除限流状态
        Account->>Redis: 清除限流标记 (如果存在)
        Relay-->>Client: 返回成功响应
    end
```

## 🔧 关键配置参数

| 参数 | 值 | 说明 |
|------|-----|------|
| Token提前刷新时间 | 60秒 | 在Token过期前60秒开始刷新 |
| 分布式锁TTL | 60秒 | 防止死锁的超时时间 |
| 限流自动恢复时间 | 1小时 | 被限流后自动恢复的时间 |
| 锁冲突等待时间 | 2秒 | 获取锁失败后的等待时间 |
| OAuth请求超时 | 30秒 | Token刷新请求的超时时间 |
| 会话映射TTL | 1小时 | 粘性会话的过期时间 |

## 🗄️ Redis数据结构

### Claude账户数据
```json
{
  "id": "account-uuid",
  "name": "账户名称",
  "accessToken": "encrypted_access_token",
  "refreshToken": "encrypted_refresh_token", 
  "expiresAt": "1640995200000",
  "rateLimitedAt": "2024-01-15T10:30:00.000Z",
  "rateLimitStatus": "limited",
  "lastUsedAt": "2024-01-15T09:30:00.000Z",
  "lastRefreshAt": "2024-01-15T08:30:00.000Z"
}
```

### 分布式锁
```
Key: token_refresh_lock:claude:account-id
Value: unique-uuid
TTL: 60秒
```

### 粘性会话映射
```
Key: session_mapping:session-hash
Value: account-id
TTL: 3600秒
```

## 📈 监控指标

- **限流账户数量**: 当前被限流的账户总数
- **Token刷新成功率**: 刷新成功/总刷新次数
- **账户切换频率**: 因限流导致的账户切换次数
- **平均恢复时间**: 从限流到自动恢复的平均时间
- **并发刷新冲突**: 分布式锁冲突的次数

这个设计确保了高可用性、自动恢复和智能负载均衡，同时保证了数据安全和系统稳定性。