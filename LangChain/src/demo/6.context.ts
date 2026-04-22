/**
 * 6.context.ts - Context Compact (上下文压缩)
 *
 * 三层压缩策略，实现无限会话：
 *   Layer 1: micro_compact - 用占位符替换旧的工具结果
 *   Layer 2: auto_compact - token 超过阈值时自动摘要
 *   Layer 3: compact tool - 模型主动触发的手动压缩
 *
 *     工具调用结果
 *     +------------------+
 *     | 大型输出内容     |
 *     +------------------+
 *             |
 *             v
 *     [Layer 1: micro_compact]        (静默，每轮执行)
 *     将超过 3 轮的工具结果替换为
 *     "[Previous: used {tool_name}]"
 *             |
 *             v
 *     [检查: tokens > 50000?]
 *        |               |
 *       否              是
 *        |               |
 *        v               v
 *     继续      [Layer 2: auto_compact]
 *                 保存对话到 .transcripts/
 *                 LLM 生成摘要
 *                 用摘要替换所有消息
 *                         |
 *                         v
 *                 [Layer 3: compact tool]
 *                   模型显式调用 compact
 */

import { ChatOpenAI } from "@langchain/openai";
import { tool } from "langchain";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  BaseMessage,
} from "@langchain/core/messages";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import * as readline from "readline";
import { log, newLogFile } from "./utils/logger.js";

dotenv.config();

const WORKDIR = process.cwd();
const TRANSCRIPTS_DIR = path.join(WORKDIR, ".transcripts");
const KEEP_RECENT = 3; // 保留最近 N 个工具结果（测试最小值）
const TOKEN_THRESHOLD = 1000; // 自动压缩阈值（测试最小值）

// 确保 transcripts 目录存在
if (!fs.existsSync(TRANSCRIPTS_DIR)) {
  fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
}

// -- 路径安全校验 --
function safePath(p: string): string {
  const resolved = path.resolve(WORKDIR, p);
  if (!resolved.startsWith(WORKDIR)) {
    throw new Error(`路径逃逸工作目录: ${p}`);
  }
  return resolved;
}

// -- 获取消息类型字符串（替代已弃用的 _getType()） --
function getMessageType(msg: BaseMessage): string {
  if (msg instanceof HumanMessage) return "human";
  if (msg instanceof AIMessage) return "ai";
  if (msg instanceof SystemMessage) return "system";
  if (msg instanceof ToolMessage) return "tool";
  return "unknown";
}

// -- Token 估算（粗略：1 token ≈ 4 字符） --
function estimateTokens(messages: BaseMessage[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    const content = typeof msg.content === "string" 
      ? msg.content 
      : JSON.stringify(msg.content);
    totalChars += content.length;
  }
  return Math.ceil(totalChars / 4);
}

// -- Layer 1: micro_compact --
function microCompact(messages: BaseMessage[]): void {
  /**
   * 将旧的工具结果（>KEEP_RECENT 轮）替换为占位符。
   * 静默压缩，每轮执行。
   */
  const toolResults: { index: number; toolName: string }[] = [];
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg instanceof ToolMessage) {
      const toolMsg = msg;
      // 从前一条 AIMessage 提取工具名称
      let toolName = "unknown_tool";
      if (i > 0) {
        const prevMsg = messages[i - 1];
        if (prevMsg instanceof AIMessage) {
          const matchingCall = prevMsg.tool_calls?.find((tc: any) => tc.id === toolMsg.tool_call_id);
          if (matchingCall) {
            toolName = (matchingCall as any).name;
          }
        }
      }
      toolResults.push({ index: i, toolName });
    }
  }

  // 仅保留最近的工具结果
  if (toolResults.length <= KEEP_RECENT) {
    return;
  }

  const oldResults = toolResults.slice(0, -KEEP_RECENT);
  for (const { index, toolName } of oldResults) {
    const msg = messages[index] as ToolMessage;
    const content = typeof msg.content === "string" ? msg.content : "";
    if (content.length > 50) {
      // 用占位符替换工具结果（测试最小阈值）
      (msg as any).content = `[Previous: used ${toolName}]`;
      log(`[micro_compact] 替换旧工具结果: ${toolName}`);
    }
  }
}

// -- Layer 2: auto_compact --
async function autoCompact(messages: BaseMessage[]): Promise<BaseMessage[]> {
  /**
   * 保存对话到磁盘，然后让 LLM 生成摘要。
   * 当 token 超过阈值时触发。
   */
  // 保存完整对话用于恢复
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const transcriptPath = path.join(TRANSCRIPTS_DIR, `transcript-${timestamp}.jsonl`);
  
  const transcriptData = messages.map(msg => ({
    type: getMessageType(msg),
    content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
    tool_calls: (msg as AIMessage).tool_calls || undefined,
    tool_call_id: (msg as ToolMessage).tool_call_id || undefined,
  }));
  
  fs.writeFileSync(transcriptPath, transcriptData.map(d => JSON.stringify(d)).join("\n"));
  log(`[auto_compact] 已保存对话到 ${transcriptPath}`);

  // LLM 生成摘要
  const summaryLLM = new ChatOpenAI({
    model: "qwen-plus",
    temperature: 0.3,
    maxTokens: 200,
  });

  const conversationStr = messages.map(msg => {
    const role = getMessageType(msg);
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    return `[${role}]: ${content.slice(0, 2000)}`; // 测试最小摘要长度
  }).join("\n\n");

  const summaryPrompt = `请总结这段对话，以便后续继续工作。需要包含：
1. 用户的原始请求是什么？
2. 目前完成了什么？
3. 当前状态或下一步是什么？

要简洁，但保留继续工作所需的关键上下文。

对话内容：
${conversationStr}`;

  const response = await summaryLLM.invoke([
    new HumanMessage({ content: summaryPrompt })
  ]);

  const summary = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  log(`[auto_compact] 摘要: ${summary.slice(0, 300)}...`);

  // 用摘要替换所有消息
  return [
    new HumanMessage({ 
      content: `[已压缩]\n\n${summary}\n\n之前的对话已保存到: ${transcriptPath}` 
    })
  ];
}

// -- 工具实现 --
function runBash(command: string): string {
  const dangerous = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];
  if (dangerous.some((d) => command.includes(d))) {
    return "错误: 危险命令已被拦截";
  }
  try {
    const result = execSync(command, {
      cwd: WORKDIR,
      encoding: "utf-8",
      timeout: 120000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = result.toString().trim();
    return output.slice(0, 50000) || "(无输出)";
  } catch (error: any) {
    const stderr = error.stderr?.toString() || "";
    const stdout = error.stdout?.toString() || "";
    const output = (stdout + stderr).trim() || error.message;
    return `错误: ${output.slice(0, 50000)}`;
  }
}

function runRead(filePath: string, limit?: number): string {
  try {
    const safe = safePath(filePath);
    const content = fs.readFileSync(safe, "utf-8");
    const lines = content.split("\n");
    if (limit && limit < lines.length) {
      return lines
        .slice(0, limit)
        .concat([`... (还有 ${lines.length - limit} 行)`])
        .join("\n")
        .slice(0, 50000);
    }
    return content.slice(0, 50000);
  } catch (error: any) {
    return `错误: ${error.message}`;
  }
}

function runWrite(filePath: string, content: string): string {
  try {
    const safe = safePath(filePath);
    const dir = path.dirname(safe);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(safe, content);
    return `已写入 ${content.length} 字节到 ${filePath}`;
  } catch (error: any) {
    return `错误: ${error.message}`;
  }
}

function runEdit(filePath: string, oldText: string, newText: string): string {
  try {
    const safe = safePath(filePath);
    const content = fs.readFileSync(safe, "utf-8");
    if (!content.includes(oldText)) {
      return `错误: 在 ${filePath} 中未找到文本`;
    }
    const newContent = content.replace(oldText, newText);
    fs.writeFileSync(safe, newContent);
    return `已编辑 ${filePath}`;
  } catch (error: any) {
    return `错误: ${error.message}`;
  }
}

// -- 工具定义 --
const bashTool = tool((input: { command: string }) => runBash(input.command), {
  name: "bash",
  description: "运行 shell 命令。",
  schema: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
});

const readTool = tool(
  (input: { path: string; limit?: number }) => runRead(input.path, input.limit),
  {
    name: "read_file",
    description: "读取文件内容。",
    schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        limit: { type: "number" },
      },
      required: ["path"],
    },
  },
);

const writeTool = tool(
  (input: { path: string; content: string }) =>
    runWrite(input.path, input.content),
  {
    name: "write_file",
    description: "写入内容到文件。",
    schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
);

const editTool = tool(
  (input: { path: string; old_text: string; new_text: string }) =>
    runEdit(input.path, input.old_text, input.new_text),
  {
    name: "edit_file",
    description: "替换文件中的精确文本。",
    schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_text: { type: "string" },
        new_text: { type: "string" },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
);

// -- Layer 3: compact 工具 --
let pendingCompact = false;

const compactTool = tool(
  () => {
    pendingCompact = true;
    return "对话将在本轮结束后压缩。";
  },
  {
    name: "compact",
    description: "压缩对话历史，保留关键上下文。**必须在以下情况主动调用**：\n1. 用户明确要求'压缩'、'总结'、'清理上下文'时\n2. 连续读取多个文件（>3个）后\n3. 对话超过5轮时\n4. 感觉上下文冗余时",
    schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
);

// -- LLM 配置 --
const llm = new ChatOpenAI({
  model: "qwen-plus",
  temperature: 0.5,
  maxTokens: 8000,
});

const llmWithTools = llm.bindTools([bashTool, readTool, writeTool, editTool, compactTool]);

// -- 工具分发映射 --
const TOOL_HANDLERS: Record<string, (args: Record<string, any>) => string> = {
  bash: (args) => runBash(args.command),
  read_file: (args) => runRead(args.path, args.limit),
  write_file: (args) => runWrite(args.path, args.content),
  edit_file: (args) => runEdit(args.path, args.old_text, args.new_text),
  compact: () => pendingCompact ? "已安排压缩。" : "已安排压缩。",
};

// -- 系统提示 --
const SYSTEM_PROMPT = `你是工作在 ${WORKDIR} 的代码助手。

**重要**：你有一个 'compact' 工具用于压缩对话历史。必须在以下情况主动调用：
1. 用户明确要求"压缩"、"总结"、"清理上下文"时 → 立即调用 compact
2. 连续读取多个文件（>3个）后 → 调用 compact 释放空间
3. 对话超过5轮 → 考虑调用 compact
4. 感觉上下文冗余时 → 调用 compact

系统也会在 token 超过 ${TOKEN_THRESHOLD} 时自动压缩。`;

// -- 带三层压缩的 Agent 循环 --
const agentLoop = async (messages: BaseMessage[]) => {
  while (true) {
    // Layer 1: micro_compact（每轮执行）
    microCompact(messages);

    // Layer 2: auto_compact 检查
    const tokens = estimateTokens(messages);
    log(`当前 tokens: ~${tokens}`);
    
    if (tokens > TOKEN_THRESHOLD) {
      log(`[auto_compact] 超过阈值 (${tokens} > ${TOKEN_THRESHOLD})`);
      const compressed = await autoCompact(messages);
      messages.length = 0;
      messages.push(...compressed);
    }

    const messagesWithSystem = [
      new SystemMessage({ content: SYSTEM_PROMPT }),
      ...messages,
    ];

    const response = await llmWithTools.invoke(messagesWithSystem);
    log(`LLM Response: ${JSON.stringify(response, null, 2)}`);
    messages.push(response);

    // 检查结束原因
    if (response.response_metadata?.finish_reason !== "tool_calls") {
      // Layer 3: 检查手动压缩
      if (pendingCompact) {
        pendingCompact = false;
        log(`[compact tool] 触发手动压缩`);
        const compressed = await autoCompact(messages);
        messages.length = 0;
        messages.push(...compressed);
        continue; // 压缩后继续循环
      }
      return;
    }

    // 执行工具
    const results: ToolMessage[] = [];

    if (response.tool_calls) {
      for (const toolCall of response.tool_calls) {
        const handler = TOOL_HANDLERS[toolCall.name];
        let output: string;

        try {
          output = handler
            ? handler(toolCall.args)
            : `未知工具: ${toolCall.name}`;
        } catch (error: any) {
          output = `错误: ${error.message}`;
        }

        console.log(`  ${output.slice(0, 200)}`);
        results.push(
          new ToolMessage({
            tool_call_id: toolCall.id!,
            content: output,
          }),
        );
      }
    }

    messages.push(...results);

    // Layer 3: 工具执行后检查手动压缩
    if (pendingCompact) {
      pendingCompact = false;
      log(`[compact tool] 触发手动压缩`);
      const compressed = await autoCompact(messages);
      messages.length = 0;
      messages.push(...compressed);
    }
  }
};

// -- REPL 主循环 --
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (prompt: string): Promise<string> => {
  return new Promise((resolve) => rl.question(prompt, resolve));
};

const main = async () => {
  const history: BaseMessage[] = [];
  newLogFile(); // 会话开始时创建一个日志文件

  while (true) {
    try {
      const query = await question("\x1b[36ms06 >> \x1b[0m");
      const cmd = query.trim().toLowerCase();
      if (cmd === "q" || cmd === "exit" || cmd === "") {
        break;
      }
      history.push(new HumanMessage({ content: query }));
      log(`History: ${JSON.stringify(history, null, 2)}`);
      await agentLoop(history);
      // 打印最终响应
      const lastContent = history[history.length - 1]?.content;
      if (typeof lastContent === "string") {
        console.log(lastContent);
      }
      console.log();
      log(`=== 对话结束 ===`); // 添加分隔符标记单轮对话结束
    } catch (error) {
      console.log(error);
      break;
    }
  }

  rl.close();
};

main();
