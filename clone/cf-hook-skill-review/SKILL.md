---
name: cf-hook-skill-review
description: Use when implementing an automatic skill-capture loop in CodeFlicker using the Stop hook, inspired by hermes-agent's _spawn_background_review mechanism
version: 1.0.0
author: mabohui <mabohui@kuaishou.com>
---

# CF Hook Skill Review

## Overview

借鉴 hermes-agent 的 `_spawn_background_review` 机制，用 CodeFlicker 的 `Stop` hook + `SessionStart` hook + subagent 实现对话结束后自动分析并保存可复用 skill 的闭环。不依赖 hermes 运行，CF 自己完成整个进化循环。

核心洞察：CF 的 `Stop` hook（Agent 停止运行时触发）和 hermes 的"对话结束触发"完全对等。有了这个，hermes 的学习闭环可以完整移植。

## When to Use

- 想让 CF 在完成复杂任务后自动识别可复用模式并写入 skill
- 想把 hermes 的自进化能力移植到 CodeFlicker
- NOT: 手动创建单个 skill（用 `writing-skills`）

## Core Pattern

三组件 + 两 hook 注册：

```
Stop hook (skill-review-trigger.js)
  → 检查 tool_call_count >= 阈值
  → 写入 ~/.codeflicker/skill-review-queue/<session_id>.json

SessionStart hook (check-skill-queue.js)
  → 检查 queue 目录
  → 有待处理任务 → 注入 additionalContext
  → 主 Agent 调用 use_subagent("skill-reviewer")

skill-reviewer subagent (skill-reviewer.md)
  → 读取 transcript
  → 判断有无可复用模式
  → 有 → 写 SKILL.md；无 → 静默跳过
```

## Installation

### Step 1: 复制 hook 脚本

```bash
mkdir -p ~/.codeflicker/kwaipilot-hooks
cp skill-review-trigger.js ~/.codeflicker/kwaipilot-hooks/
cp check-skill-queue.js ~/.codeflicker/kwaipilot-hooks/
```

### Step 2: 复制 subagent 定义

```bash
cp skill-reviewer.md ~/.codeflicker/agents/
```

### Step 3: 注册 hooks

将 `settings.json.example` 的内容合并到 `~/.codeflicker/settings.json`。**注意：不要覆盖现有配置，只追加新字段。**

### Step 4: 重启 CodeFlicker

Hook 配置在启动时加载，运行中修改不会热重载。必须重启 IDE。

### Step 5: 验证

完成一个含 5+ 工具调用的对话，结束对话，查看：
```bash
ls ~/.codeflicker/skill-review-queue/
```
有 JSON 文件 → Stop hook 生效。

开始新对话，看 SessionStart 是否注入提示 → 闭环完整。

## Configuration

| 参数 | 位置 | 默认值 | 说明 |
|------|------|--------|------|
| `THRESHOLD` | skill-review-trigger.js 第 9 行 | 5 | 工具调用次数阈值，达到后触发 review |
| `QUEUE_DIR` | skill-review-trigger.js 第 11 行 | ~/.codeflicker/skill-review-queue | review 队列目录 |

调整阈值：直接修改 skill-review-trigger.js 顶部的 `THRESHOLD` 常量。

## Troubleshooting

| 问题 | 原因 | 解决 |
|------|------|------|
| Stop hook 不触发 | settings.json 配置后没重启 | 重启 IDE |
| transcript_path 为 null | mem-bank 路径结构变化 | 检查 `~/.codeflicker/mem-bank/threads/` 目录结构 |
| skill-reviewer 不运行 | SessionStart hook 没注入提示 | 检查 queue 目录是否有文件 |
| 每次都跳过不创建 skill | 对话内容没有可复用模式 | 这是正常行为，保守原则生效 |

## Common Pitfalls

1. **改了 settings.json 忘了重启** — hook 配置不会热重载，必须重启 IDE
2. **transcript 找不到** — mem-bank 目录结构是 `threads/<workspace>/<session>/transcripts/0000.md`，如果 CF 版本变化路径可能不同
3. **Stop hook payload 没有 last_assistant_message** — 实际 payload 只有 session_id + tool_call_count + tool_error_count，脚本用 transcript 兜底
4. **debug PreToolUse hook 和新 hook 混在一起** — 建议清理无用的 debug hook，避免 hooks.jsonl 过大

## Real-World Impact

从 self-evolve（被动触发，从未实际使用）到 cf-hook-skill-review（主动触发，每次有价值的对话自动分析），进化能力的实际覆盖率从 0% 提升到接近 100%。