#!/usr/bin/env node
// Skill Review Trigger Hook
// 事件：Stop
// 功能：工具调用次数达到阈值时，将 review 请求写入队列，供下次 SessionStart 处理

const fs = require('fs');
const path = require('path');

const THRESHOLD = 5; // 工具调用次数阈值
const CF_HOME = path.join(process.env.HOME, '.codeflicker');
const QUEUE_DIR = path.join(CF_HOME, 'skill-review-queue');
const MEM_BANK_DIR = path.join(CF_HOME, 'mem-bank', 'threads');

async function findTranscript(session_id) {
  // 路径结构：mem-bank/threads/<workspace_id>/<session_id>/transcripts/0000.md
  // 遍历所有 workspace 目录查找匹配的 session
  try {
    const workspaces = fs.readdirSync(MEM_BANK_DIR);
    for (const ws of workspaces) {
      const transcriptPath = path.join(MEM_BANK_DIR, ws, session_id, 'transcripts', '0000.md');
      if (fs.existsSync(transcriptPath)) {
        const content = fs.readFileSync(transcriptPath, 'utf-8');
        return content.slice(0, 30000); // 截取前 30k 字符
      }
    }
  } catch (_) {}
  return '';
}

async function main() {
  // 读取 Stop hook payload
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

  const { session_id, tool_call_count, last_assistant_message } = payload;

  // 未达到阈值，跳过
  if (!tool_call_count || tool_call_count < THRESHOLD) {
    process.stdout.write(JSON.stringify({ continue: true }) + '\n');
    return;
  }

  // 查找 transcript
  let transcriptContent = await findTranscript(session_id);

  // transcript 读取失败时用 last_assistant_message 兜底
  if (!transcriptContent && last_assistant_message) {
    transcriptContent = `[最后一条 AI 回复]\n${last_assistant_message}`;
  }

  // 没有可分析的对话内容，跳过写入 queue
  if (!transcriptContent && !last_assistant_message) {
    process.stdout.write(JSON.stringify({ continue: true }) + '\n');
    return;
  }

  // 将 transcript 写入临时文件
  const tmpFile = path.join('/tmp', `cf-skill-review-${session_id}.txt`);
  if (transcriptContent) {
    fs.writeFileSync(tmpFile, transcriptContent, 'utf-8');
  }

  // 写入 review queue（去重：如果已有同 session_id 的文件则覆盖）
  fs.mkdirSync(QUEUE_DIR, { recursive: true });
  const reviewRequest = {
    session_id,
    tool_call_count,
    transcript_path: transcriptContent ? tmpFile : null,
    last_assistant_message: last_assistant_message || '',
    triggered_at: new Date().toISOString(),
  };
  const requestFile = path.join(QUEUE_DIR, `${session_id}.json`);
  fs.writeFileSync(requestFile, JSON.stringify(reviewRequest, null, 2), 'utf-8');

  process.stdout.write(JSON.stringify({ continue: true }) + '\n');
}

main().catch(e => {
  process.stderr.write(String(e) + '\n');
  // hook 失败不阻断主流程
  process.stdout.write(JSON.stringify({ continue: true }) + '\n');
});
