# api-proxy — Claude Code API 抓包代理

一个用于**学习 Claude Code 与模型 API 通信协议**的本地抓包代理：拦截 Claude Code 发出的 Anthropic 格式请求，记录完整的请求/响应到本地文件，并提供一个 Web 面板进行可视化分析。

## 架构

```
Claude Code ──► proxy (:8899, 抓包) ──► ccr (:3457, 路由) ──► wanqing 端点
                    │
                    └──► 面板 (:8898, 浏览器打开)
```

- **代理端口 8899**：接收 Claude Code 的 Anthropic 格式请求，原样转发给上游（边收边转发，SSE 流式不被阻塞），同时把完整请求/响应落盘到 `logs/NNN.json`
- **面板端口 8898**：Web 可视化界面，实时查看抓包记录
- **上游 ccr (3457)**：claude-code-router 负责真实路由（wanqing 端点、模型改写、`stripreasoning` 参数清理）

## 文件说明

| 文件 | 作用 |
|------|------|
| `proxy.mjs` | 代理主程序 + 内嵌 Web 面板（单文件，无外部依赖） |
| `start.sh` | 一键启动：拉起代理（如未运行）+ 以抓包模式启动 Claude Code |
| `logs/NNN.json` | 抓包记录，每条请求一个文件，含请求头（已脱敏）/请求体/响应头/响应体/耗时/token 用量 |
| `proxy.out` | （历史遗留）早期转发脚本 |

## 快速开始

```bash
# 启动（代理没跑会自动后台拉起，然后进入 Claude Code）
./start.sh

# 面板
open http://127.0.0.1:8898
```

`start.sh` 的关键机制：启动 Claude Code 前注入环境变量
`ANTHROPIC_BASE_URL=http://127.0.0.1:8899/api/anthropic`（流量导向代理）
和 `ANTHROPIC_AUTH_TOKEN=<占位值>`（跳过 /login，真实鉴权在 ccr 层完成）。

## ⚠️ 哪些启动方式会被抓包

**只有通过 `./start.sh` 启动的会话才会被抓包。**

直接运行 `ccr code` 不会被抓包 —— 这是 ccr 的机制决定的：`ccr code` 启动 Claude Code 时会强制注入
`ANTHROPIC_BASE_URL = http://127.0.0.1:<ccr自己的PORT>`，流量直连 ccr，外部代理无法插入（除非修改 ccr 内部，已明确不做）。

| 启动方式 | 链路 | 抓包 |
|---------|------|------|
| `./start.sh` | CC → proxy(8899) → ccr(3457) → wanqing | ✅ |
| `ccr code` | CC → ccr(3457) → wanqing | ❌ |

## 面板功能

- **顶栏统计**：总请求数 / 成功 / 错误 / 累计 Token 用量（↓输入 ↑输出）
- **列表**：搜索（路径/模型/状态码/编号）、按状态和模型筛选；每条显示状态灯、耗时、token 消耗；↑↓ 键快速切换；最新记录在最上
- **请求体 Tab**：默认「原始 JSON」可折叠树（保留原生结构，第 3 层起自动折叠）；可切「结构视图」—— system 块 / messages 轮次 / tools 列表（支持按名称搜索）分区卡片
- **响应体 (SSE) Tab**：
  - 📝 **拼接文本预览**：自动把所有 `text_delta`（及 `thinking_delta`）按序拼回模型完整输出
  - 事件类型统计条，点击筛选
  - 事件卡片按类型着色（message_start 蓝 / content_block_delta 绿 / message_delta 黄…），默认折叠、摘要显示关键信息（模型、stop_reason、输出 tokens 等）
- **通用**：JSON 语法高亮、可折叠树（展开/折叠全部）、复制当前 Tab、下载完整 JSON、自动刷新开关、清空记录

## 配置

### 切换上游（proxy.mjs 顶部）

改 `UPSTREAM_MODE` 一个词即可：

| 模式 | 上游 | 说明 |
|------|------|------|
| `'ccr'` | `http://127.0.0.1:3457` | 当前使用；转发时剥掉 `/api/anthropic` 前缀 |
| `'bigmodel'` | `https://open.bigmodel.cn` | 0915 旧链路（智谱 GLM 直连），保留备用 |

### 端口

- 代理 `8899`、面板 `8898`（8080 被 Chrome 远程调试占用，故避开）
- 修改后需重启代理：`pkill -f "node proxy.mjs" && nohup node proxy.mjs > /tmp/api-proxy.log 2>&1 &`

## 已知坑与设计要点（踩坑记录）

1. **目录搬家后抓包失效**：落盘路径若在启动时快照，目录被移动/改名后写入全部 ENOENT（且被兜底逻辑静默吞掉，表现为"会话正常但没数据"）。已改为运行时动态解析 `getLogDir()`：优先脚本所在目录，失效则回退到启动时 cwd，且每次写入前自动 mkdir。
2. **抓包序号续接**：代理重启后从 `logs/` 已有文件的最大编号继续，避免覆盖旧记录。
3. **`reasoning` 参数 400**：wanqing 的 OpenAI 兼容端点不认识 `reasoning` 字段（ccr 转换 Anthropic thinking 时会注入）。已在 **ccr 侧**配置自定义 transformer `stripreasoning`（位于 `~/.claude-code-router/transformers/`，在 ccr 的 config.json 注册）删除该参数。**不要撤掉它**，否则走 ccr 的请求会报 400。
4. **`effortLevel` 与 400 的关系**：settings.json 的 `effortLevel` 会让 Claude Code 开启 thinking，进而触发上一条问题；根因在 `reasoning` 字段本身， stripper 已在 ccr 层根治。
5. **模板字符串里的转义**：面板 HTML 是 Node 模板字符串，内部 JS 的 `\n`、`\'` 等需要双倍反斜杠书写；内联 onclick 事件**不要传字符串参数**（用 `data-*` 属性 + 无参 handler），否则极易出现浏览器端 `Unexpected string` 语法错误。
6. **上游错误被静默**：代理有 `uncaughtException` 兜底不会退出，排查问题看 `/tmp/api-proxy.log`（或启动时的 stdout 重定向文件）。

## 协议学习指南

配合面板学习 Anthropic Messages API 的推荐路径：

1. **请求体**：看 `model` / `system`（系统提示词分块与 cache_control 打点）/ `tools`（工具三件套 name-description-input_schema）/ `messages`（content blocks：text、tool_use、tool_result、thinking）
2. **响应体 (SSE)**：事件时序 `message_start`（元信息+输入 tokens）→ `content_block_start` → 多个 `content_block_delta`（增量文本）→ `content_block_stop` → `message_delta`（stop_reason + 累计输出 tokens）→ `message_stop`
3. **拼接预览**：理解"流式输出 = 增量 delta 的有序拼接"这一核心模型
4. **请求头**：注意 `anthropic-version`、`anthropic-beta`（如 context-1m）等头部的作用
