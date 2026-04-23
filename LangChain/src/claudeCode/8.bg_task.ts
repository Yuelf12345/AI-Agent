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
import { execSync, spawn } from "child_process";
import * as readline from "readline";
import { v7 as uuid7 } from "uuid";
import { log, newLogFile } from "./utils/logger.js";

dotenv.config();

const WORKDIR = process.cwd();

interface BackgroundTask {
  status: "running" | "completed" | "timeout" | "error";
  result: string | null;
  command: string;
}
interface Notification {
  task_id: string;
  status: string;
  command: string;
  result: string;
}
class BackgroundManager {
  private tasks: Map<string, BackgroundTask> = new Map();
  private notificationQueue: Notification[] = [];
  private lock = new Object();

  /**
   * 启动后台线程
   * @param command
   * @returns
   */
  run(command: string): string {
    const task_id = uuid7().substring(0, 8);
    this.tasks.set(task_id, {
      status: "running",
      result: null,
      command: command,
    });
    // 启动后台线程处理
    this.executeAsync(task_id, command);
    return `后台任务 ${task_id} 已启动: ${command.substring(0, 80)}`;
  }
  private executeAsync(task_id: string, command: string): void {
    const child = spawn(command, [], {
      cwd: WORKDIR,
      shell: true,
      timeout: 3600,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      const output = (stdout + stderr).trim().slice(0, 50000) || "(无输出)";
      const status = code === 0 ? "completed" : "error";
      // 更新任务状态
      this.tasks.set(task_id, {
        status,
        result: output,
        command: command,
      });
      // 添加通知队列
      this.enqueueNotification({
        task_id,
        status,
        command: command.substring(0, 80),
        result: (output || "(无输出)").substring(0, 500),
      });
    });
    // 错误处理

    child.on("error", (err) => {
      const output = `错误: ${err.message}`;
      this.tasks.set(task_id, {
        status: "error",
        result: output,
        command: this.tasks.get(task_id)?.command || command,
      });

      this.enqueueNotification({
        task_id: task_id,
        status: "error",
        command: command.slice(0, 80),
        result: output.slice(0, 500),
      });
    });
  }
  private enqueueNotification(notif: Notification): void {
    this.notificationQueue.push(notif);
  }
  /**
   * 检查任务
   * @param task_id
   */
  check(task_id?: string): string {
    if (task_id) {
      const task = this.tasks.get(task_id);
      if (!task) {
        return `错误: 未知任务 ${task_id}`;
      }
      return `[${task.status}] ${task.command.slice(0, 60)}\n${task.result || "(运行中)"}`;
    }
    // 列出所有任务
    const lines: string[] = [];
    for (const [tid, task] of this.tasks.entries()) {
      lines.push(`${tid}: [${task.status}] ${task.command.slice(0, 60)}`);
    }
    return lines.join("\n") || "没有后台任务。";
  }
  drainNotifications(): Notification[] {
    // 返回并清空所有待处理的通知
    const notifs = [...this.notificationQueue];
    this.notificationQueue = [];
    return notifs;
  }
}
const BG = new BackgroundManager();
// -- 路径安全校验 --
function safePath(p: string): string {
  const resolved = path.resolve(WORKDIR, p);
  if (!resolved.startsWith(WORKDIR)) {
    throw new Error(`路径逃逸工作目录: ${p}`);
  }
  return resolved;
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
        limit: { type: "integer" },
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

// -- 任务工具定义 --
// 后台运行命令工具
const bgRunTool = tool((input: { command: string }) => BG.run(input.command), {
  name: "background_run",
  description: "在后台运行 shell 命令，立即返回任务 ID。",
  schema: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
});
// 检查后台任务工具
const bgCheckTool = tool(
  (input: { task_id?: string }) => BG.check(input.task_id),
  {
    name: "background_check",
    description:
      "检查后台任务状态。不带参数列出所有任务，带任务ID检查特定任务。",
    schema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
      },
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

const llmWithTools = llm.bindTools([
  bashTool,
  readTool,
  writeTool,
  editTool,
  bgRunTool,
  bgCheckTool,
]);

// -- 工具分发映射 --
const TOOL_HANDLERS: Record<string, (args: Record<string, any>) => string> = {
  bash: (args) => runBash(args.command),
  read_file: (args) => runRead(args.path, args.limit),
  write_file: (args) => runWrite(args.path, args.content),
  edit_file: (args) => runEdit(args.path, args.old_text, args.new_text),
  background_run: (args) => BG.run(args.command),
  background_check: (args) => BG.check(args.task_id),
};

// -- 系统提示 --
const SYSTEM_PROMPT = `你是工作在 ${WORKDIR} 的代码助手。对于长时间的命令, 请使用 background_run 工具。`;

// -- Agent 循环 --
const agentLoop = async (messages: BaseMessage[]) => {
  while (true) {
    // 在每次 LLM 调用前，排空后台通知队列
    const notifs = BG.drainNotifications();
    if (notifs.length > 0 && messages.length > 0) {
      const notifText = notifs
        .map(
          (n) =>
            `[bg:${n.task_id}] ${n.status}: ${n.result ?? "已完成"}`,
        )
        .join("\n");
      messages.push(
        new HumanMessage({
          content: `<background-results>\n${notifText}\n</background-results>`,
        }),
      );
    }

    const messagesWithSystem = [
      new SystemMessage({ content: SYSTEM_PROMPT }),
      ...messages,
    ];

    const response = await llmWithTools.invoke(messagesWithSystem);
    log(`LLM Response: ${JSON.stringify(response, null, 2)}`);
    messages.push(response);

    // 检查是否需要工具调用
    if (response.response_metadata?.finish_reason !== "tool_calls") {
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

        console.log(`> ${toolCall.name}:`);
        console.log(String(output).slice(0, 200));

        results.push(
          new ToolMessage({
            tool_call_id: toolCall.id!,
            content: String(output),
          }),
        );
      }
    }

    messages.push(...results);
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
      const query = await question("\x1b[36ms07 >> \x1b[0m");
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
