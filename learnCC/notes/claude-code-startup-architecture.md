# Claude Code 启动架构学习笔记

> 学习对象：`claude-code-analysis/src/main.tsx`（约 5000 行主入口）及其调用的 `init.ts`、`setup.ts`、`replLauncher.tsx`、`ink/root.ts`
> 学习日期：2026-09-15

---

## 一、全局图景：一次 `claude` 命令背后发生了什么

```
用户敲下 claude [参数]
        │
        ▼
┌─ 模块加载阶段（~135ms）─────────────────────────────┐
│ import 语句之间夹着预热调用：                        │
│   profileCheckpoint / startMdmRawRead /             │
│   startKeychainPrefetch   ← 子进程与加载并行         │
└─────────────────────────────────────────────────────┘
        │
        ▼
main()  入口
  ├─ 安全检查（反调试、Windows 路径劫持防护）
  ├─ argv 预处理（cc:// / assistant / ssh 剥离改写）
  ├─ 判定交互/无头模式 → 初始化 entrypoint / clientType
  └─ eagerLoadSettings() → await run()
                │
                ▼
run()  CLI 总装
  ├─ preAction 钩子：await 预取 → init() → 迁移 → sink
  ├─ 定义全部 CLI 选项（几十个）
  └─ .action 回调 = 真正主体（约 3100 行）
        │
        ├── C1 选项提取与校验（不合格 → exit(1)）
        ├── C2 MCP 解析 + 企业策略过滤 + 权限上下文
        ├── C3 setup() ∥ getCommands() ∥ getAgentDefs() 三路并行
        ├── C4 模型 / agent / 系统提示词解析
        ├── C5 信任屏（仅交互）→ 信任后初始化
        └── 分流
             ├─ 非交互 → await import('print.js') → runHeadless()
             └─ 交互   → 七岔口 → launchRepl(root, appProps, replProps, renderAndRun)
```

**一句话心智模型**：main 是大门，run 是接待台，init 是"让进程能正常工作"，setup 是"为这次会话安家"，最后上菜给 print.ts（无头）或 REPL（交互）。

---

## 二、main.tsx 主入口

### 2.1 顶层副作用的并行化（启动优化核心手法）

文件开头（第 1-21 行）在 **import 语句之间**插入了三个调用：

| 调用 | 作用 | 省了多少 |
|---|---|---|
| `profileCheckpoint('main_tsx_entry')` | 启动埋点 | 测量基准 |
| `startMdmRawRead()` | 提前 spawn `plutil`/`reg query` 读 MDM 企业设置 | 与 ~135ms 导入重叠 |
| `startKeychainPrefetch()` | 并行读两把 macOS 钥匙串（OAuth + legacy key） | 旧实现 sync spawn 串行 ~65ms |

**原理**：ES Module 的 import 在任何顶层代码之前**同步求值**，耗时 ~135ms；而 MDM/钥匙串读取本来就只能 spawn 系统二进制（plutil / security / reg）。把 spawn 提到 import 之间 → 子进程在 OS 层与主线程模块求值**并行**，总耗时从"求和"变成"取最大"。

```
优化前：135ms(imports) + 45ms(MDM) + 65ms(keychain) ≈ 245ms  串行
优化后：max(135ms, 子进程耗时) ≈ 135ms                      重叠
```

**三个配套细节**：
1. 消费端 `ensureMdmSettingsLoaded()` / `ensureKeychainPrefetchCompleted()` 在 preAction 里 await —— 此时子进程早已完成，"nearly free"
2. `rawRead.ts` 用**同步** `existsSync` 先判断文件是否存在（非 MDM 机器 ~90% 直接跳过 spawn），且保证 `execFile` 是第一个 await（spawn 必须在事件循环轮询前发出）
3. 预取模块**最小化依赖**：keychainPrefetch 刻意不 import macOsKeychainStorage（会拉进 execa 链，+58ms 模块初始化），否则省的时间被吃回去

### 2.2 其他关键点

- **反调试**：`isBeingDebugged()` 检测 `--inspect` 等 → `process.exit(1)`
- **Windows 防路径劫持**：`NoDefaultCurrentDirectoryInExePath = '1'`
- **退出礼仪**：`process.on('exit', () => resetCursor())` —— Ink 渲染时隐藏了终端光标（`\x1b[?25l`），退出时写 `SHOW_CURSOR`（`\x1b[?25h`）恢复，否则用户终端光标会消失。SIGINT 处理器通过 `process.exit(0)` 间接触发该钩子
- **process.argv**：`[node路径, 脚本路径, ...用户参数]`，用户参数从下标 2 开始；main() 会改写 argv 来预处理 `cc://`、`assistant`、`ssh` 等特殊子命令
- **numStartups**：全局配置里的启动次数计数器，是"新手 vs 老手"的本地信号（tips 只给 numStartups > 3/5/10 的用户看、首启不弹 EffortCallout）。**同步 +1** 因为首屏渲染的 useState 初始化器要读最新值；只有遥测用 setImmediate 推迟

### 2.3 feature() —— 编译期功能开关

```ts
import { feature } from 'bun:bundle'
const coordinatorModeModule = feature('COORDINATOR_MODE') ? require(...) : null
```

- `bun:bundle` 是打包器虚拟模块，`feature('X')` 在**构建时**被替换为 true/false 字面量
- 配合 minifier 死代码消除：关闭的分支连同模块、**字符串**一起从产物中物理消失
- 用途：内外版本分离（`"external" === 'ant'` 也是同款常量折叠）、实验功能按需携带、防内部字符串泄露
- 与运行时开关（GrowthBook `tengu_*`）的区别：前者构建期定生死（代码存在与否），后者运行期定行为（灰度/A-B）

---

## 三、run() 函数（约 3700 行）

### 3.1 结构：壳 + 巨型回调

```
run() [928]
├── 块A: preAction 钩子            每次执行子命令前的公共初始化
├── 块B: CLI 选项定义（.option 链）
└── 块C: .action 回调 = 主体
      ├── C1 特殊模式预处理 + 选项提取校验
      ├── C2 MCP/工具/权限初始化
      ├── C3 setup() 并行化
      ├── C4 模型/agent/提示词解析
      ├── C5 信任屏 + 信任后初始化
      ├── C6 遥测/thinking/插件版本化
      ├── C7 无头分支 → runHeadless → return
      └── C8/C9 交互状态构建 + 七岔口 → launchRepl
```

### 3.2 preAction 钩子（为什么用钩子）

`claude --help`、`-v` 也走 Commander 但不该初始化 → 用 `program.hook('preAction')` 只在真正执行命令时触发。顺序：await 预取 → `init()` → 终端标题 → 挂日志 sink（子命令不调 setup() 否则 exit 时丢事件）→ 接通 `--plugin-dir`（gh-33508）→ `runMigrations()`（版本号 11）→ 企业远程设置 → 设置同步。

### 3.3 无头分支（print 模式）要点

- 判定：`-p` / `--init-only` / `--sdk-url` / `!process.stdout.isTTY`（**stdout 非终端自动降级无头**）
- 命令过滤：无头只支持 prompt 型命令 + 声明支持无头的 local 命令
- MCP 逐台连接：先推 pending 占位再替换；常规服务器**全部 await**（单轮 -p 第一 turn 必须有完整工具列表）；claude.ai 连接器 5s 上限（40+ 慢连接器曾把 p99 拖到 76s 的教训）；两轮去重
- 出口：`await import('src/cli/print.js')` → `void runHeadless(...)` → return。动态 import 让交互式用户完全不为它付费

### 3.4 交互七岔口（命中即 launchRepl 并 return）

| 条件 | 行为 |
|---|---|
| `--continue` | 清缓存 → 恢复最近会话 → launchRepl |
| `cc://` 直连 | createDirectConnectSession → launchRepl（工具走远端） |
| `claude ssh` | 探测/部署 → SSH 隧道 + unix socket 反向代理 → launchRepl（工具远程执行，UI 本地渲染） |
| `claude assistant` | 发现远程助手会话 → launchRepl 作为纯查看端 |
| `--remote` | 任务上云：创建 CCR 云端会话（旧：打印 URL 退出；新：本地 TUI + 云引擎） |
| `--teleport` | 会话回家：拉回云端会话（严格校验仓库匹配 + git 状态，防跑错代码库） |
| 默认 | 新会话 → launchRepl |

`--remote` / `--teleport` 是 CCR 云端会话的一对操作（上云 / 回家）；`--remote-control(--rc)` 是另一个功能（远程控制本地会话的桥）。

### 3.5 launchRepl 的四个参数

```ts
launchRepl(root, appProps, replProps, renderAndRun)
```

| 参数 | 是什么 | 内容 |
|---|---|---|
| `root` | Ink 渲染根（画布） | createRoot() 建一次，多屏复用 |
| `appProps` | 外层壳组件 props | `{ getFpsMetrics, stats, initialState }` —— 全局状态（run() 前 3000 行的沉淀） |
| `replProps` | REPL 界面 props | `sessionConfig`（commands/tools/MCP/systemPrompt/thinkingConfig…）+ 分支特有（initialMessages 等） |
| `renderAndRun` | 渲染执行器（依赖注入） | 挂载组件树 → 等待退出；测试可替换 |

本质：`renderAndRun(root, <App {...appProps}><REPL {...replProps}/></App>)`。

### 3.6 root 与 Ink

- **Ink** = 终端版 React：组件渲染到终端字符而非 DOM
- `Root` = 终端版 `react-dom` 的 createRoot，三个方法：`render / unmount / waitUntilExit`
- 创建与渲染分离 → 同一画布依次渲染信任对话框 → 选择器 → REPL 多屏

### 3.7 读 run() 的方法（心法）

1. **profileCheckpoint 当目录**：埋点名就是阶段名
2. **找出口倒推**：`process.exit(1)`（校验失败）/ `runHeadless`（无头出口）/ `launchRepl`（交互出口 ×7）
3. **识别四种套路**：校验失败（红字+exit）、提前发射（void prefetch）、条件导入（feature/import()）、设置全局（setXxx 存 bootstrap state）
4. 心智模型：**漏斗** —— 前 3000 行收敛（几百个选项 → 两个入场包），最后 600 行发散（两个大出口、七个交互入口）

---

## 四、init() —— 全局环境初始化

位置：`entrypoints/init.ts`，被 memoize 包裹（全进程只跑一次），在 preAction 中最先调用。

### 步骤清单

1. `enableConfigs()` 启用配置系统
2. `applySafeConfigEnvironmentVariables()` —— **只应用安全版环境变量**（危险变量如 PATH/LD_PRELOAD 要等信任通过）
3. `applyExtraCACertsFromConfig()` —— 必须赶在第一次 TLS 握手前（Bun 的 BoringSSL 启动时缓存证书库）
4. `setupGracefulShutdown()`
5. 1P 事件日志（动态 import 推迟 OpenTelemetry 加载）+ GrowthBook 配置变化热重建
6. 异步预取 ×4：OAuth 账号信息、JetBrains 检测、GitHub 仓库检测、远程设置/策略 loading promise（只创建 promise 不发起）
7. 网络栈（严格顺序）：mTLS → 全局 HTTP agent（代理）→ **preconnectAnthropicApi()**（提前 TCP+TLS 握手 ~100-200ms 与后续工作重叠；必须在 CA/代理之后，否则预热连接用错传输层）
8. CCR 上游代理（条件）、Windows shell
9. 注册清理钩子：LSP 关闭、swarm 团队清理（gh-32730：团队文件曾永久残留）
10. scratchpad 目录
11. 错误处理：ConfigParseError → 交互弹 InvalidConfigDialog / 无头 stderr+退出（不能弹 UI 污染 JSON 输出）；其他 rethrow

### 关联函数

- `initializeTelemetryAfterTrust()`：OpenTelemetry 刻意放在**信任之后**——企业可通过远程设置关遥测，所以等远程设置加载完、重应用环境变量后再初始化；`telemetryInitialized` 标志防双重初始化
- `setMeterState()`：懒加载 ~400KB OpenTelemetry 模块

---

## 五、setup() —— 会话环境初始化

位置：`setup.ts`，9 个参数（全是 Commander 解析产物），每命令执行一次，与 getCommands() 并行调用。

### 步骤清单

1. Node ≥ 18 检查（失败 exit(1)）
2. 切换自定义会话 ID
3. UDS 消息服务（**await 到 socket 绑定**，保证 `$CLAUDE_CODE_MESSAGING_SOCKET` 在任何 hook spawn 子进程快照 env 之前就位）
4. teammate 模式快照
5. 恢复被中断的 iTerm2/Terminal.app 设置（上次崩溃的自动还原）
6. **`setCwd()`** —— 分水岭：之后的一切目录敏感
7. hooks 配置快照（防会话中途被偷偷改 hook；必须在 setCwd 后拍）+ FileChanged watcher
8. worktree 创建：git 校验（或 hook 支持非 git）→ 回主仓库根 → 建 worktree（+tmux）→ **process.chdir** → 更新 originalCwd/projectRoot → 清 CLAUDE.md 缓存 → **重拍 hooks 快照**（换了目录 settings 就是另一份）
9. 后台任务发射：会话记忆、contextCollapse、`lockCurrentVersion()`（防升级流程删掉正在运行的版本）、插件 hooks 预加载 + 热更新
10. `initSinks()` → **`logEvent('tengu_started')`** —— 存活信号刻意放在一切可能抛错的 I/O 之前（inc-3694 P0 事故：CHANGELOG 崩溃导致其后所有事件全丢）
11. apiKeyHelper 预取（仅已信任才真正执行）
12. Logo/发布说明数据（await，首屏要用）
13. **bypassPermissions 安全门**：root/sudo 拒绝；ant 内部还要求无网络的 Docker/Bubblewrap 沙箱 —— "爆炸半径为零才允许跳过权限"
14. 补报上次会话退出统计（tengu_exit；报完不清空，resume 要用）

### 两个函数的关系对照

| | init() | setup() |
|---|---|---|
| 调用时机 | preAction，选项解析前 | action 内，与命令加载并行 |
| 管什么 | 全局环境：配置/网络/遥测 | 会话环境：目录/worktree/hooks |
| 参数 | 无 | 9 个 CLI 解析产物 |
| 执行次数 | memoize 一次 | 每命令一次 |

---

## 六、为什么拆成两个函数（六条轴）

1. **参数依赖轴**：init 在选项解析前（无参）；worktree 等需要 9 个 CLI 参数 → setup
2. **cwd 依赖轴**：init 全部目录无关（enableConfigs 读用户级配置）；setup 定义 cwd 并处理 chdir，线下步骤目录敏感
3. **作用域轴**：init 被所有子命令共享（doctor 也要网络/配置/清理）；worktree/UDS/终端备份只有主会话需要
4. **生命周期轴**：init 是进程级单例（memoize）；hooks 快照等需要随目录刷新（chdir 后重拍）——放 memoize 里会被缓存吞掉
5. **编排轴**：init 必须串行最早完成（一切的前提）；setup 刻意设计成可与 getCommands 并行（~28ms 主要是 socket bind 非磁盘 I/O）；worktree 是唯一例外（chdir 导致不并行），代码里 `worktreeEnabled ? null : getCommands(...)` 特殊处理
6. **杀进程权限轴**（Node 检查案例）：init 被 SDK 等宿主进程场景共享，**不能在里面 process.exit**；setup 是纯 CLI 路径，进程是自己的 → Node 版本检查虽按依赖该进 init，但因"失败要 exit(1)"归入 setup

判定决策树：

```
依赖 CLI 选项? ──是──→ setup()
    │否
依赖/影响 cwd? ──是──→ setup()
    │否
所有子命令都需要? ──否──→ setup()
    │是
失败时可以杀进程? ──否──→ setup() 或入口层
    │是
需要每命令刷新? ──是──→ setup()
    │否
                  → init()
```

---

## 七、贯穿全篇的设计模式

| 模式 | 示例 | 要点 |
|---|---|---|
| **启动预取并行化** | MDM/钥匙串/API preconnect/命令加载 | 把耗时的系统调用尽早发射（夹在 import 间/void Promise），与主线程工作重叠；总耗时从求和变取最大 |
| **消费端懒 await** | ensureKeychainPrefetchCompleted() | 发射与消费分离，await 已就绪的 Promise 几乎免费 |
| **feature() 编译期开关** | KAIROS / COORDINATOR_MODE / ant | 构建时常量替换 + 死代码消除，物理隔离内外版本 |
| **动态 import** | print.js / setup.js / sinks.js | 分支路径按需付费 + 可插埋点测加载耗时 |
| **信任边界** | safe env vs full env；LSP/git 推迟到信任后 | 不受信目录的 settings.json 是攻击面，危险操作必须等信任对话框 |
| **memoize 单例** | init() | 全局初始化只跑一次 |
| **依赖注入** | launchRepl 的 renderAndRun | 组装与渲染策略分离，可测试 |
| **幂等激活** | maybeActivateProactive/Brief | "maybe"守门员模式，多分支重复调用无副作用 |
| **失败语义分层** | Node 检查 exit(1) 在 setup | 谁能杀进程取决于路径归属（CLI vs 嵌入宿主） |

---

## 八、自检问题（检验是否真的懂了）

1. 为什么 `startMdmRawRead()` 要夹在 import 语句之间，而不是放在文件末尾？
2. `rawRead.ts` 为什么用同步 `existsSync` 而不是异步版本？
3. `feature('KAIROS')` 和 GrowthBook 门控 `tengu_kairos` 有什么区别？
4. `-p` 模式下用户没敲 `-p` 但输出被重定向了，会发生什么？（提示：isTTY）
5. worktree 创建为什么不能与 getCommands() 并行？
6. Node 版本检查为什么在 setup 而不在 init？
7. numStartups 为什么同步递增而遥测用 setImmediate？
8. `claude --remote` 和 `claude --teleport` 的方向和校验差异是什么？
9. launchRepl 四个参数各自承担什么职责？为什么要传 renderAndRun 函数而不是内部写死？
10. init() 里 applySafeConfigEnvironmentVariables 和 print 分支里的 applyConfigEnvironmentVariables 差在哪？

---

## 九、一句话总结

> **Claude Code 的启动是一条精心编排的流水线：main 把耗时系统调用藏进模块加载的空隙，run 把几百个 CLI 选项收敛校验后装进两个"入场包"，init 铺好进程级全局环境（配置/网络/遥测），setup 为会话安家（目录/hooks/安全门），最后按有无终端把控制权交给 runHeadless 或 launchRepl——每一层职责都能用"参数依赖、cwd 依赖、作用域、生命周期、编排、失败语义"六条轴唯一确定。**
