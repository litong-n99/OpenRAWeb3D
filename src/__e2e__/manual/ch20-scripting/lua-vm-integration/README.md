# Lua VM Integration (fengari) -- 人工验收

> **人工验收测试页**
> 模块: LuaScriptAdapter.ts
> 测试ID: `ch20-scripting/lua-vm-integration`
> OpenRA 对照: `OpenRA.Game/Scripting/ScriptContext.cs` (Lua runtime init)
> 创建日期: 2026-06-18
> 审核状态: PENDING REVIEW

---

## 测试目标

本测试页面验证 fengari Lua 5.3 VM 在浏览器中的集成行为：

1. **Sandbox 安全限制**：危险全局变量 (os, io, require, dofile, loadfile, debug, coroutine, math.random, math.randomseed) 已被正确移除
2. **Global API 调用**：TypeScript ScriptGlobal 实例的方法和属性可从 Lua 脚本中访问和调用
3. **WorldLoaded / Tick 回调**：Lua 函数定义和引擎回调触发机制正常工作
4. **Print 输出**：Lua print() 输出被正确捕获并显示
5. **错误处理**：Lua 运行时错误和 FatalError() 被正确传播

---

## 期望结果（可量化验收标准）

### 期望 1: Sandbox 安全隔离

**操作**: 点击 "Sandbox" 预设按钮，然后点击 "Execute Lua"。

**量化标准**:
- `os == nil` 返回 true（os 被移除）
- `io == nil` 返回 true（io 被移除）
- `require == nil` 返回 true（require 被移除）
- `math.random == nil` 返回 true（math.random 被移除）
- `pairs()` 正常工作，遍历 table 元素数量正确（2 个键值对）
- `table.insert()` 正常工作，数组长度增加 1

**失败判定**: 任一危险全局变量仍然可访问 -> **BLOCKER**

### 期望 2: Global API 调用

**操作**: 点击 "API Call" 预设按钮，然后点击 "Execute Lua"。

**量化标准**:
- `TestAPI.greet("World")` 返回 `"Hello, World!"`（无拼写错误）
- `TestAPI.add(10, 20)` 返回 `30`（整数加法正确）
- `TestAPI.version` 返回 `"1.0.0-phaseG"`（字符串属性读取正确）

**失败判定**: 任一 API 返回错误结果或抛出异常 -> **BLOCKER**

### 期望 3: Callback 函数定义和调用

**操作**: 点击 "Callbacks" 预设按钮，然后点击 "Execute Lua"，再点击 "Run All Automated Tests"。

**量化标准**:
- `WorldLoaded()` 函数定义成功，调用返回 `"world_loaded_ok"`
- `Tick()` 函数定义成功，首次调用返回 `1`（计数器从 0 开始递增）
- 第二次调用 `Tick()` 返回 `2`（计数器正确递增）

**失败判定**: 函数定义失败或返回值不正确 -> **MAJOR**

### 期望 4: Print 输出捕获

**操作**: 点击 "Print" 预设按钮，然后点击 "Execute Lua"。

**量化标准**:
- 输出面板显示 `=== Lua Print Test ===` 标题行
- 包含数字输出行（`Number = 42`）
- 包含布尔值输出行（`Boolean = true`）
- Table keys 拼接正确（`a b c ` 三个键，空格分隔）
- 总共输出 7 行

**失败判定**: print 无输出或输出内容不完整 -> **MAJOR**

### 期望 5: 错误处理传播

**操作**: 点击 "Error" 预设按钮，然后点击 "Execute Lua"，再点击 "Run All Automated Tests"。

**量化标准**:
- `pcall()` 正确捕获 `error("deliberate Lua runtime error")`，status 为 false
- err 消息包含 `"deliberate Lua runtime error"`
- FatalError 调用触发 fatalErrorHandler（通过 "Run All Tests" 触发）

**失败判定**: 错误未被传播或 pcall 未正确捕获 -> **BLOCKER**

---

## 检验流程

### 准备工作

1. 打开测试页面：`http://localhost:5173/test/ch20-scripting/lua-vm-integration/`
2. 确认状态栏显示 "Runtime ready. Sandbox active"
3. 确认输出面板显示 "Lua runtime initialized successfully."

### 步骤一：Sandbox 验证

1. 点击 "Sandbox" 预设按钮，Lua 输入框显示沙箱测试代码
2. 点击 "Execute Lua" 按钮
3. 观察输出面板：
   - `os removed: true`
   - `io removed: true`
   - `require removed: true`
   - `math.random removed: true`
   - `pairs works: true`
   - `table.insert works: true`

**预期**: 符合期望 1

### 步骤二：Global API 验证

1. 点击 "API Call" 预设按钮
2. 点击 "Execute Lua" 按钮
3. 观察输出面板：
   - `TestAPI.greet: true -> Hello, World!`
   - `TestAPI.add: true -> 30`
   - `TestAPI.version: true -> 1.0.0-phaseG`

**预期**: 符合期望 2

### 步骤三：Callback 验证

1. 点击 "Callbacks" 预设按钮，点击 "Execute Lua"
2. 观察输出面板确认 WorldLoaded 和 Tick 已定义
3. 点击 "Run All Automated Tests" 按钮
4. 观察测试结果：
   - WorldLoaded PASS: Result = world_loaded_ok
   - Tick PASS: Result = 1

**预期**: 符合期望 3

### 步骤四：Print 验证

1. 点击 "Print" 预设按钮，点击 "Execute Lua"
2. 观察输出面板包含所有 7 行输出
3. 确认数字和布尔值格式正确

**预期**: 符合期望 4

### 步骤五：Error 验证

1. 点击 "Error" 预设按钮，点击 "Execute Lua"
2. 观察输出面板确认 pcall 成功捕获错误
3. 点击 "Run All Automated Tests" 确认 Error handling PASS

**预期**: 符合期望 5

### 边界/异常测试

1. **空脚本输入**：点击 Execute 但不输入任何代码 -> "No code to execute." 提示
2. **语法错误**：输入 `local x = {` 并执行 -> 错误消息包含文件名和行号
3. **运行时错误**：输入 `error("test")` 并执行 -> 显示 Lua 错误信息
4. **大量循环**：输入 `for i=1,100000 do end` -> 不应崩溃，正常完成
5. **FatalError**：输入 `FatalError("critical")` -> 输出面板显示 FatalError 消息（红色）

---

## 结果判定

| 判定结果 | 条件 |
|---------|------|
| **ACCEPTED** | 全部 5 项期望通过 |
| **PARTIAL** | 部分未通过，已记录具体差异 |
| **REJECTED** | BLOCKER 级问题 |

- [ ] 期望 1 通过（Sandbox 安全隔离）
- [ ] 期望 2 通过（Global API 调用）
- [ ] 期望 3 通过（Callback 定义和调用）
- [ ] 期望 4 通过（Print 输出捕获）
- [ ] 期望 5 通过（错误处理传播）

**最终判定: PENDING REVIEW**

**设备信息**:
- GPU: __________
- 浏览器: __________
- 操作系统: __________
- 视口: __________
