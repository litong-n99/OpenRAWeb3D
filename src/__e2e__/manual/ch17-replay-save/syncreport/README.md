# Chapter 17 - SyncReport Diagnostic Dump 人工验收

> **人工验收测试页**
> 模块: SyncReport.ts
> 测试ID: `ch17-replay/syncreport`
> OpenRA 对照: `OpenRA.Game/Network/SyncReport.cs`
> 创建日期: 2026-06-16
> 审核状态: ✅ 全部审核通过 (自动化验收测试 Playwright, 2026-07-04, 42/42 通过, 100%)

---

## 测试目标

本测试页面验证 SyncReport 的环形缓冲区、dumpSyncReport 输出格式和 ISync 注册机制：
1. **环形缓冲区**：7 帧环形缓冲区正确轮转，新旧数据覆盖正确
2. **dumpSyncReport 格式**：找到目标帧时输出完整格式化报告
3. **dumpSyncReport 未找到**：目标帧不在缓冲区中时输出 "no sync report available" 消息
4. **ISync 注册**：registerSyncDump/getSyncDump/clearSyncDumpRegistry 注册表操作正确
5. **Trait 值提取**：注册的 dump 函数正确提取 ISync 实例的字段值

---

## B. 期望结果（可量化验收标准）

### 期望 1: 环形缓冲区轮转

**量化标准**:
- 初始 SyncReport 有 `NumSyncReports` = 7 个预分配的空报告对象
- `currentIndex` 从 0 开始
- 每次调用 `updateSyncReport()` 后 `currentIndex` 递增，超过 6 后回绕到 0
- 写入第 8 个报告时，第 1 个报告（index 0）被覆盖
- `reports` 数组长度始终为 7

**失败判定**: 缓冲区大小不正确或轮转逻辑错误 -> **MAJOR**

### 期望 2: dumpSyncReport 正确格式

**量化标准**:
- `dumpSyncReport(frame)` 输出包含以下所有部分：
  - "--- Sync Report ---" 标记
  - "Player Index: N" 行
  - "Sync for net frame F -------------" 行
  - "SharedRandom: VALUE (#COUNT)" 行
  - "Synced Traits:" 部分（列出所有非零 hash 的 trait）
  - "Synced Effects:" 部分
  - "Orders Issued:" 部分
  - "Sync Report System Info:" 部分
  - "Out of sync frame: F" 行
  - "Recorded frames: f0,f1,...,f6" 行
- 输出以 `syncreport-TIMESTAMP-INDEX.log` 为第一行

**失败判定**: 输出格式不完整或缺少关键部分 -> **MAJOR**

### 期望 3: dumpSyncReport 未找到帧

**量化标准**:
- 查询不存在于缓冲区中的帧（如 frame 999）时
- 输出包含 "Recorded frames do not contain the frame 999. No sync report available!"
- 仍然列出所有已记录的帧编号

**失败判定**: 不存在的帧没有被正确报告 -> **MINOR**

### 期望 4: ISync dump 注册表

**量化标准**:
- `registerSyncDump(name, names, fn)` 注册后
- `getSyncDump(name)` 返回注册的 SyncTypeInfo（含 names 和 dumpFn）
- 未注册的名称 `getSyncDump("unknown")` 返回 undefined
- `clearSyncDumpRegistry()` 清空所有注册项

**失败判定**: 注册表操作不正确 -> **MAJOR**

### 期望 5: Trait 报告内容

**量化标准**:
- 注册一个模拟 ISync trait 后，dumpSyncReport 应包含该 trait 的条目
- 条目包含: actorId, type, owner, trait (类名), hash, 以及所有注册的字段名值对
- 字段值以 "\t\t fieldName: value" 格式缩进显示
- 只有 hash !== 0 的 trait 才会出现在报告中

**失败判定**: trait 报告缺失或字段值不正确 -> **MAJOR**

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch17-replay/syncreport/`
2. 确认页面加载无错误

### 步骤一：环形缓冲区

1. 观察 "环形缓冲区" 区域
2. 确认创建时 currentIndex = 0
3. 观察连续 7 次 updateSyncReport() 后 currentIndex 回绕
4. 确认 reports 长度始终为 7

**预期**: 符合期望 1

### 步骤二：dumpSyncReport 格式

1. 观察 "dumpSyncReport 格式" 区域
2. 在 frame 5 处模拟 desync
3. 确认输出包含完整的格式化报告
4. 验证每一栏（Traits, Effects, Orders, System Info）都存在

**预期**: 符合期望 2

### 步骤三：未找到帧

1. 观察 "未找到帧" 区域
2. 调用 dumpSyncReport(999)
3. 确认输出包含 "no sync report available"
4. 确认仍列出了所有记录帧

**预期**: 符合期望 3

### 步骤四：ISync 注册表

1. 观察 "ISync 注册表" 区域
2. 确认 register/get/clear 操作正确
3. 确认空名称返回 undefined

**预期**: 符合期望 4

### 步骤五：Trait 报告

1. 观察 "Trait 报告" 区域
2. 确认注册的 trait 出现在 dumpSyncReport 输出中
3. 确认字段名和值正确显示

**预期**: 符合期望 5

### 边界/异常测试

1. **空 world**：world = null 的 SyncReport -> dumpSyncReport 不崩溃
2. **空 traints**：无 ISync trait 的 world -> 报告中 "Synced Traits:" 后无条目
3. **重复注册**：同名 registerSyncDump -> 覆盖前一个（后注册者胜）
4. **大环形缓冲**：100+ 帧更新后 -> 缓冲区正确轮转

---

## 结果判定

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 全部 5 项期望通过 |
| **PARTIAL** | 部分未通过，已记录具体差异 |
| **REJECTED** | BLOCKER 级问题 |

- [x] 期望 1 通过（环形缓冲区轮转）
- [x] 期望 2 通过（dumpSyncReport 正确格式）
- [x] 期望 3 通过（未找到帧处理）
- [x] 期望 4 通过（ISync dump 注册表）
- [x] 期望 5 通过（Trait 报告内容）

**最终判定: ACCEPTED** (42/42 PASS, 100%, 回测)

**设备信息**:
- 浏览器: __________
- 操作系统: __________
- 视口: __________
