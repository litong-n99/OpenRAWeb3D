# Chapter 17 - Game Save Binary Format Round-Trip 人工验收

> **人工验收测试页**
> 模块: GameSave.ts (含 SlotClient)
> 测试ID: `ch17-replay/gamesave-roundtrip`
> OpenRA 对照: `OpenRA.Game/Network/GameSave.cs`
> 创建日期: 2026-06-16
> 审核状态: PENDING REVIEW

---

## 测试目标

本测试页面验证 GameSave 的 .orasav 二进制格式完整性和端到端往返完整性：
1. **空 GameSave 创建**：初始状态正确（LastOrdersFrame=-1, LastSyncFrame=-1）
2. **startGame() 配置快照**：正确深拷贝 GlobalSettings、Slots、SlotClients
3. **dispatchOrders() 订单录制**：订单正确写入订单流，同步包更新 LastSyncFrame
4. **save() 二进制出力**：生成符合规范的 .orasav 文件
5. **加载二进制 GameSave**：从 .orasav 二进制数据重新构造，字段完全匹配
6. **addTraitData + parseOrders 往返**：特性数据先于订单发出，订单顺序正确

---

## B. 期望结果（可量化验收标准）

### 期望 1: 空 GameSave 初始状态

**量化标准**:
- `LastOrdersFrame` = -1
- `LastSyncFrame` = -1
- `ordersStreamLength` = 0
- `ordersChunkCount` = 0
- `GlobalSettings` = null
- `Slots` 为空 Map
- `SlotClients` 为空 Map
- `TraitData` 为空 Map

**失败判定**: 任何初始值与预期不符 -> **MAJOR**

### 期望 2: startGame() 配置快照

**量化标准**:
- 调用 startGame() 后 `GlobalSettings` 为非 null 对象，其 `map`、`randomSeed` 等字段与源数据一致
- `Slots` 包含与源数据相同数量的条目
- `SlotClients` 包含可玩槽位的玩家配置
- SlotClient 的 faction、color、spawnPoint、team 与源 SessionClient 一致
- 修改源数据后 GameSave 中的快照不变（深拷贝）

**失败判定**: 快照内容不完整或不正确 -> **MAJOR**

### 期望 3: dispatchOrders 订单录制

**量化标准**:
- 每次 dispatchOrders() 后 `ordersChunkCount` 递增 1
- `ordersStreamLength` 随数据增加而增长
- `LastOrdersFrame` 更新为最新帧编号
- frame <= LastOrdersFrame 的订单被跳过（不重复录制）
- 同步哈希包（0x65 前缀）更新 `LastSyncFrame` 但不影响 ordersChunkCount（同步包不写入订单流）

**失败判定**: 订单流长度不正确或同步包处理错误 -> **BLOCKER**

### 期望 4: save() 二进制输出格式

**量化标准**:
- save() 返回非空 Uint8Array
- 尾部最后 4 字节 = EOF_MARKER (-2, 即 0xFEFFFFFF 小端序)
- 从尾部正确解析 metadataOffset（倒数第12-9字节）和 traitDataOffset（倒数第8-5字节）
- 元数据部分以 METADATA_MARKER (-1) 开头
- 特性数据部分以 TRAIT_DATA_MARKER (-3) 开头

**失败判定**: 二进制格式不符合规范 -> **BLOCKER**

### 期望 5: 加载二进制 GameSave（往返验证）

**量化标准**:
- 从 save() 输出的 Uint8Array 构造新的 GameSave(filepath, buffer)
- 新旧 GameSave 的 LastOrdersFrame 值相等
- 新旧 GameSave 的 LastSyncFrame 值相等
- 新旧 GameSave 的 GlobalSettings 内容一致（JSON.stringify 比较）
- 新旧 GameSave 的 Slots 条目数相同，键名匹配
- 新旧 GameSave 的 SlotClients 条目数相同，faction/team/color 匹配
- 新旧 GameSave 的 TraitData 条目数相同，键值匹配

**失败判定**: 往返后任何字段不一致 -> **BLOCKER**

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch17-replay/gamesave-roundtrip/`
2. 确认环境信息栏显示 UA、视口尺寸
3. 确认页面无 JavaScript 错误

### 步骤一：空 GameSave 初始状态

1. 观察 "空 GameSave" 区域
2. 确认所有初始值显示为预期值（-1, 0, null, empty）
3. 全部显示绿色 PASS

**预期**: 符合期望 1

### 步骤二：startGame 快照

1. 观察 "startGame 快照" 区域
2. 确认 GlobalSettings.map = "test_map", randomSeed = 42
3. 确认 Slots 包含 2 个条目
4. 确认 SlotClients 包含 2 个条目
5. SlotClient 字段与源数据一致

**预期**: 符合期望 2

### 步骤三：dispatchOrders 录制

1. 观察 "订单录制" 区域
2. 确认每次 dispatchOrders 后 chunk count 递增
3. 确认 LastOrdersFrame 正确更新
4. 确认重复帧被跳过
5. 确认同步包更新 LastSyncFrame

**预期**: 符合期望 3

### 步骤四：二进制输出验证

1. 观察 "二进制输出" 区域
2. 确认 save() 返回非空 Uint8Array
3. 确认尾部 EOF_MARKER = -2
4. 确认元数据 marker 位置正确

**预期**: 符合期望 4

### 步骤五：加载往返验证

1. 观察 "加载往返" 区域
2. 逐字段比较新旧 GameSave
3. 全部显示绿色 PASS
4. 确认 parseOrders 回调正确发出 trait data 和 orders

**预期**: 符合期望 5

### 边界/异常测试

1. **无效 .orasav 文件**：用随机字节构造 -> 抛异常
2. **空订单流**：无订单的 save -> 正确生成 tail-only 二进制
3. **大量订单**：100+ 订单 -> 往返后数据一致
4. **MapGenerationArgs**：设置地图生成参数 -> 往返后参数一致

---

## 结果判定

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 全部 5 项期望通过 |
| **PARTIAL** | 部分未通过，已记录具体差异 |
| **REJECTED** | BLOCKER 级问题 |

- [ ] 期望 1 通过（空 GameSave 初始状态）
- [ ] 期望 2 通过（startGame 配置快照）
- [ ] 期望 3 通过（dispatchOrders 订单录制）
- [ ] 期望 4 通过（save 二进制输出格式）
- [ ] 期望 5 通过（加载往返验证）

**最终判定: PENDING REVIEW**

**设备信息**:
- 浏览器: __________
- 操作系统: __________
- 视口: __________
