#!/usr/bin/env node
// Check Skill Review Queue Hook
// 事件：SessionStart
// 功能：检查 skill-review-queue 目录，有待处理任务时注入 additionalContext，
//       触发 Agent 自动调用 use_subagent("skill-reviewer")

const fs = require('fs');
const path = require('path');

const CF_HOME = path.join(process.env.HOME, '.codeflicker');
const QUEUE_DIR = path.join(CF_HOME, 'skill-review-queue');

async function main() {
  // 读取 SessionStart payload
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  // payload 包含 session_id, cwd, source, agentMode 等

  // 检查 queue 目录
  let pendingFiles = [];
  try {
    pendingFiles = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.json'));
  } catch (_) {
    // queue 目录不存在，正常情况
  }

  if (pendingFiles.length === 0) {
    process.stdout.write(JSON.stringify({ continue: true }) + '\n');
    return;
  }

  // 有待处理任务，注入 additionalContext 触发 skill-reviewer
  const context = [
    `[Skill Review Queue] 有 ${pendingFiles.length} 个待处理的 skill review 任务。`,
    `队列目录：${QUEUE_DIR}`,
    `请在响应用户之前，调用 use_subagent("skill-reviewer") 处理这些任务。`,
    `处理完成后正常继续。`,
  ].join('\n');

  process.stdout.write(JSON.stringify({
    continue: true,
    additionalContext: context,
  }) + '\n');
}

main().catch(e => {
  process.stderr.write(String(e) + '\n');
  process.stdout.write(JSON.stringify({ continue: true }) + '\n');
});
