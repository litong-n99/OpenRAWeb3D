# Chapter 17 - Replay Recording & Playback Round-Trip 人工验收

> **人工验收测试页**
> 模块: ReplayRecorder.ts + ReplayConnection.ts
> 测试ID: `ch17-replay/replay-roundtrip`
> OpenRA 对照: `OpenRA.Game/Network/ReplayRecorder.cs` + `ReplayConnection.cs`
> 创建日期: 2026-06-16
> **审核状态**: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-07-04, 63/63 通过, 100%)

---

## 测试目标

本测试页面验证 ReplayRecorder 和 ReplayConnection 的二进制格式正确性和端到端往返完整性：
1. **ReplayRecorder 录制**：捕获模拟网络数据包，生成 .orarep 二进制文件
2. **isGameStart 检测**：正确识别 frame 0 的 StartGame 订单
3. **预启动缓冲**：StartGame 之前的数据包正确缓冲，StartGame 后刷新到主存储
4. **ReplayConnection 解析**：从 .orarep 二进制数据正确解析出 TickCount、FinalGameTick、IsValid、LobbyInfo
5. **Order 分发**：ReplayConnection.receive() 正确将录制的订单分发给模拟 OrderManager

---

## B. 期望结果（可量化验收标准）

### 期望 1: isGameStart 正确检测 StartGame

**量化标准**:
- 包含 frame=0 + orderString="StartGame" 的数据包，`ReplayRecorder.isGameStart(data)` 返回 `true`
- frame=0 但不含 StartGame 的数据包返回 `false`
- frame>0 但包含 StartGame 的数据包返回 `false`（仅 frame 0 有效）
- 空数据包（长度 < 1）返回 `false`，不抛异常

**失败判定**: isGameStart 返回结果与预期不符 -> **BLOCKER**

### 期望 2: 预启动缓冲与转换

**量化标准**:
- 在 receive() 收到 StartGame 之前，`recordingToFile` 为 `false`，所有数据包进入 preStart 缓冲
- 收到 StartGame 后，`recordingToFile` 变为 `true`，后续数据包进入主存储
- `chosenFilename` 在 StartGame 之前为空字符串 `""`，之后为回调返回的文件名
- preStart 缓冲的数据包在 dispose() 后出现在最终 .orarep 二进制输出的开头

**失败判定**: 预启动缓冲未正确工作，或 StartGame 检测失败导致转换不触发 -> **MAJOR**

### 期望 3: 二进制输出与回读

**量化标准**:
- dispose() 后 getBuffer() 返回非 null 的 Uint8Array
- 二进制格式符合规范：[clientID: int32 LE][packetLen: int32 LE][data: bytes]...
- 尾部包含 MetaStartMarker (-1) 和有效的 ReplayMetadata
- 用 ReplayMetadata.readFromBuffer() 从二进制尾部解析出 GameInformation
- ReplayConnection 从同一二进制数据构造成功，IsValid=true, TickCount>=0

**失败判定**: 二进制输出不可解析，或往返后数据不一致 -> **BLOCKER**

### 期望 4: ReplayConnection 属性正确性

**量化标准**:
- `tickCount` >= 录制时接收的最大帧编号
- `finalGameTick` 来自 ReplayMetadata 中的 GameInformation.finalGameTick
- `isValid` 仅在 frame 0 数据包包含 StartGame 时为 true
- `lobbyInfo` 包含 nonBotClients 方法和 clientWithIndex 方法
- `filename` 为构造时传入的文件名
- `localClientId` 始终返回 -1

**失败判定**: ReplayConnection 属性值不正确 -> **MAJOR**

### 期望 5: receive() 订单分发

**量化标准**:
- receive() 按帧顺序分发订单到模拟 OrderManager
- receiveImmediateOrders 在 frame 0 订单时被调用
- receiveOrders 在 frame > 0 订单时被调用
- receiveSync 在同步哈希数据包时被调用
- receiveDisconnect 在断开连接数据包时被调用
- send() 和 sendImmediate() 为空操作（回放期间不发送本地订单）

**失败判定**: 订单分发顺序或类型不正确 -> **BLOCKER**

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch17-replay/replay-roundtrip/`
2. 确认环境信息栏显示 UA、视口尺寸
3. 确认页面加载无 JavaScript 错误（控制台无红色报错）

### 步骤一：isGameStart 检测

1. 观察页面 "isGameStart 测试" 区域
2. 确认所有 5 项子测试（含 StartGame、不含 StartGame、非 frame 0、空数据包、无效数据包）显示绿色 "PASS"
3. 如有红色 "FAIL"，记录失败原因

**预期**: 符合期望 1

### 步骤二：录制与缓冲区转换

1. 观察页面 "录制测试" 区域
2. 确认录制前 recordingToFile = false
3. 确认收到 StartGame 后 recordingToFile = true
4. 确认 chosenFilename 在 StartGame 前为空，之后非空
5. 确认 preStart 缓冲包数量 + 主存储包数量 = 总数据包数

**预期**: 符合期望 2

### 步骤三：二进制输出验证

1. 点击 "生成回放" 按钮
2. 观察 "二进制数据" 区域
3. 确认显示完整的二进制 hex dump（前 256 字节）
4. 确认尾部存在 MetaStartMarker = -1 标记
5. 确认 ReplayMetadata.readFromBuffer() 成功解析

**预期**: 符合期望 3

### 步骤四：ReplayConnection 回读

1. 观察 "回放回读" 区域
2. 确认 TickCount、FinalGameTick、IsValid 均正确显示
3. 确认 LobbyInfo 结构存在（包含 clients、globalSettings、slots）
4. 确认 localClientId = -1

**预期**: 符合期望 4

### 步骤五：订单分发验证

1. 观察 "订单分发" 区域
2. 确认 receiveImmediateOrders 被调用 N 次（与 frame 0 订单数匹配）
3. 确认 receiveOrders 被调用 M 次（与 frame > 0 订单数匹配）
4. 确认分发日志中无 "未知数据包格式" 错误

**预期**: 符合期望 5

### 边界/异常测试

1. **dispose() 后 receive()**：对已销毁的 recorder 调用 receive() -> 静默忽略，不抛异常
2. **无效二进制数据**：用随机字节创建 ReplayConnection -> isValid = false
3. **空数据包**：receive() 空 Uint8Array -> 不崩溃
4. **dispose() 幂等性**：连续调用 dispose() 两次 -> 不崩溃

---

## 结果判定

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 全部 5 项期望通过 |
| **PARTIAL** | 部分未通过，已记录具体差异 |
| **REJECTED** | BLOCKER 级问题 |

- [x] 期望 1 通过（isGameStart 检测）
- [x] 期望 2 通过（预启动缓冲与转换）
- [x] 期望 3 通过（二进制输出与回读）
- [x] 期望 4 通过（ReplayConnection 属性正确性）
- [x] 期望 5 通过（receive 订单分发）

**最终判定: ACCEPTED (63/63 Playwright 测试通过, 100%)**

**设备信息**:
- 浏览器: Chromium (headless Playwright)
- 操作系统: Windows 11 Pro 10.0.26200
- 视口: 1920x1080
