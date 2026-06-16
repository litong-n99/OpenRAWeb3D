# Chapter 17 - SlotClient Serialization Round-Trip 人工验收

> **人工验收测试页**
> 模块: GameSave.ts 中的 SlotClient 内部类
> 测试ID: `ch17-replay/slotclient`
> OpenRA 对照: `OpenRA.Game/Network/GameSave.cs` (SlotClient inner class)
> 创建日期: 2026-06-16
> 审核状态: PENDING REVIEW

---

## 测试目标

本测试页面验证 SlotClient 的序列化/反序列化完整性、applyTo 属性传输正确性，以及边界情况处理：
1. **默认构造**：参数化构造器产生正确的默认值
2. **SessionClient 构造**：从 SessionClient 正确提取游戏相关字段
3. **serialize/deserialize 往返**：序列化后反序列化得出等价对象
4. **applyTo 传输**：所有字段正确写回 MutableSessionClient
5. **边界情况**：null Bot、null BotName、空字符串等

---

## B. 期望结果（可量化验收标准）

### 期望 1: 默认构造器

**量化标准**:
- color = { r: 0, g: 0, b: 0, a: 255 } (黑色，全透明)
- faction = ""
- spawnPoint = 0
- team = 0
- handicap = 0
- slot = ""
- bot = null
- isAdmin = false
- botName = ""

**失败判定**: 任何一个默认值与预期不符 -> **MINOR**

### 期望 2: SessionClient 构造器

**量化标准**:
- 从 SessionClient 传入时，color 的 r/g/b 分量与 hex 字符串 (#RRGGBB) 对应
- faction 与源 client.faction 一致
- spawnPoint、team、handicap 与源数据一致
- bot 与源 client.bot 一致
- isAdmin 与源 client.isAdmin 一致
- 当 client.bot !== null 时，botName = client.name；否则 botName = ""

**失败判定**: 任何字段与源 SessionClient 不匹配 -> **MAJOR**

### 期望 3: serialize/deserialize 往返

**量化标准**:
- serialize(key) 返回 `{ key: "SlotClient@{key}", value: {...} }`
- JSON 值中包含 color (object with r,g,b,a)、faction、spawnPoint、team、handicap、slot、bot、isAdmin、botName
- SlotClient.deserialize(serializedValue) 产生与原始对象等价的新 SlotClient
- 往返后所有属性值相等（=== 比较）

**失败判定**: 往返后任何字段不一致或 serialize 格式错误 -> **BLOCKER**

### 期望 4: applyTo 属性传输

**量化标准**:
- applyTo(mockClient) 后 mockClient.color 从默认值变为 SlotClient 的颜色 hex 字符串
- mockClient.faction、spawnPoint、team、handicap、slot、bot、isAdmin 全部更新
- 当 bot !== null 时 mockClient.name 更新为 botName；bot === null 时 name 保持不变

**失败判定**: applyTo 后任何字段未更新 -> **BLOCKER**

### 期望 5: 边界情况

**量化标准**:
- null Bot 的 SlotClient: bot=null, botName="" -> deserialize 返回值正确
- 默认构造器的 SlotClient: 所有字段为默认值 -> serialize 含全部字段
- color 解析 "#AABBCC" -> { r: 0xAA, g: 0xBB, b: 0xCC, a: 255 }
- color 解析 "DDEEFF00" -> { r: 0xEE, g: 0xFF, b: 0x00, a: 0xDD }

**失败判定**: 边界值处理错误 -> **MINOR**

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch17-replay/slotclient/`
2. 确认页面加载无错误

### 步骤一：默认构造器

1. 观察 "默认构造器" 区域
2. 确认所有 9 个字段显示预期默认值
3. 全部绿色 PASS

**预期**: 符合期望 1

### 步骤二：SessionClient 构造

1. 观察 "SessionClient 构造" 区域
2. 确认从模拟 SessionClient（含所有属性）创建的 SlotClient 字段完全一致
3. 验证 color 的 hex 字符串正确解析为 {r,g,b,a} 对象

**预期**: 符合期望 2

### 步骤三：序列化往返

1. 观察 "序列化往返" 区域
2. 确认 serialize() 返回正确的 JSON 结构
3. 确认 deserialize(json) 返回等价对象
4. 逐字段比较原对象和往返后对象 — 全部 PASS

**预期**: 符合期望 3

### 步骤四：applyTo

1. 观察 "applyTo" 区域
2. 确认 applyTo(mockClient) 后 mockClient 的所有字段已更新
3. 确认 bot === null 时 name 未被覆盖

**预期**: 符合期望 4

### 步骤五：边界情况

1. 观察 "边界情况" 区域
2. 确认各种边界值（null、空字符串、特殊颜色）被正确处理
3. 全部绿色 PASS

**预期**: 符合期望 5

---

## 结果判定

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 全部 5 项期望通过 |
| **PARTIAL** | 部分未通过，已记录具体差异 |
| **REJECTED** | BLOCKER 级问题 |

- [ ] 期望 1 通过（默认构造器）
- [ ] 期望 2 通过（SessionClient 构造）
- [ ] 期望 3 通过（序列化往返）
- [ ] 期望 4 通过（applyTo）
- [ ] 期望 5 通过（边界情况）

**最终判定: PENDING REVIEW**

**设备信息**:
- 浏览器: __________
- 操作系统: __________
- 视口: __________
