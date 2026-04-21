/**
 * 7.task.ts - Task-based Agent with Persistent Tasks
 *
 * 任务持久化系统：任务状态保存在 .tasks/ 目录下的 JSON 文件中。
 * 每个任务有依赖图 (blockedBy)，支持任务依赖管理。
 *
 *     .tasks/
 *       task_1.json  {"id":1, "subject":"...", "status":"completed", ...}
 *       task_2.json  {"id":2, "blockedBy":[1], "status":"pending", ...}
 *       task_3.json  {"id":3, "blockedBy":[2], ...}
 *
 *     依赖解析：
 *     +----------+     +----------+     +----------+
 *     | task 1   | --> | task 2   | --> | task 3   |
 *     | complete |     | blocked  |     | blocked  |
 *     +----------+     +----------+     +----------+
 *          |                ^
 *          +--- 完成 task 1 后，从 task 2 的 blockedBy 中移除
 *
 * 核心洞察："状态在压缩后依然存活 -- 因为它在对话之外。"
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
const TASKS_DIR = path.join(WORKDIR, ".tasks");

// -- TaskManager: 任务持久化与依赖管理 --
class TaskManager {
  private dir: string;
  private nextId: number;

  constructor(tasksDir: string) {
    this.dir = tasksDir;
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
    this.nextId = this.maxId() + 1;
  }

  private maxId(): number {
    const files = fs.readdirSync(this.dir).filter((f) => /^task_\d+\.json$/.test(f));
    if (files.length === 0) return 0;
    const ids = files.map((f) => parseInt(f.split("_")[1]?.split(".")[0] || "0", 10));
    return Math.max(...ids);
  }

  private load(taskId: number): Task {
    const filePath = path.join(this.dir, `task_${taskId}.json`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Task ${taskId} 不存在`);
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  }

  private save(task: Task): void {
    const filePath = path.join(this.dir, `task_${task.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(task, null, 2), "utf-8");
  }

  create(subject: string, description: string = ""): string {
    const task: Task = {
      id: this.nextId,
      subject,
      description,
      status: "pending",
      blockedBy: [],
      owner: "",
    };
    this.save(task);
    this.nextId++;
    return JSON.stringify(task, null, 2);
  }

  get(taskId: number): string {
    return JSON.stringify(this.load(taskId), null, 2);
  }

  update(
    taskId: number,
    status?: "pending" | "in_progress" | "completed",
    addBlockedBy?: number[],
    removeBlockedBy?: number[]
  ): string {
    const task = this.load(taskId);

    if (status) {
      if (!["pending", "in_progress", "completed"].includes(status)) {
        throw new Error(`无效状态: ${status}`);
      }
      task.status = status;
      if (status === "completed") {
        this.clearDependency(taskId);
      }
    }

    if (addBlockedBy && addBlockedBy.length > 0) {
      task.blockedBy = [...new Set([...task.blockedBy, ...addBlockedBy])];
    }

    if (removeBlockedBy && removeBlockedBy.length > 0) {
      task.blockedBy = task.blockedBy.filter((id) => !removeBlockedBy.includes(id));
    }

    this.save(task);
    return JSON.stringify(task, null, 2);
  }

  private clearDependency(completedId: number): void {
    // 从所有其他任务的 blockedBy 中移除已完成的任务 ID
    const files = fs.readdirSync(this.dir).filter((f) => /^task_\d+\.json$/.test(f));
    for (const file of files) {
      const filePath = path.join(this.dir, file);
      const task: Task = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (task.blockedBy.includes(completedId)) {
        task.blockedBy = task.blockedBy.filter((id) => id !== completedId);
        this.save(task);
      }
    }
  }

  listAll(): string {
    const files = fs
      .readdirSync(this.dir)
      .filter((f) => /^task_\d+\.json$/.test(f))
      .sort((a, b) => {
        const idA = parseInt(a.split("_")[1]?.split(".")[0] || "0", 10);
        const idB = parseInt(b.split("_")[1]?.split(".")[0] || "0", 10);
        return idA - idB;
      });

    if (files.length === 0) {
      return "暂无任务。";
    }

    const tasks: Task[] = files.map((f) =>
      JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf-8"))
    );

    const lines: string[] = [];
    for (const t of tasks) {
      const marker: Record<string, string> = {
        pending: "[ ]",
        in_progress: "[>]",
        completed: "[x]",
      };
      const m = marker[t.status] || "[?]";
      const blocked = t.blockedBy.length > 0 ? ` (依赖: ${t.blockedBy.join(", ")})` : "";
      lines.push(`${m} #${t.id}: ${t.subject}${blocked}`);
    }

    return lines.join("\n");
  }
}

// 任务类型定义
interface Task {
  id: number;
  subject: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  blockedBy: number[];
  owner: string;
}

// 初始化 TaskManager
const TASKS = new TaskManager(TASKS_DIR);

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
  (input: { path: string; content: string }) => runWrite(input.path, input.content),
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
const taskCreateTool = tool(
  (input: { subject: string; description?: string }) =>
    TASKS.create(input.subject, input.description),
  {
    name: "task_create",
    description: "创建新任务。",
    schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "任务主题" },
        description: { type: "string", description: "任务描述" },
      },
      required: ["subject"],
    },
  },
);

const taskUpdateTool = tool(
  (input: {
    task_id: number;
    status?: "pending" | "in_progress" | "completed";
    addBlockedBy?: number[];
    removeBlockedBy?: number[];
  }) =>
    TASKS.update(
      input.task_id,
      input.status,
      input.addBlockedBy,
      input.removeBlockedBy
    ),
  {
    name: "task_update",
    description: "更新任务状态或依赖。",
    schema: {
      type: "object",
      properties: {
        task_id: { type: "integer" },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed"],
        },
        addBlockedBy: {
          type: "array",
          items: { type: "integer" },
          description: "添加依赖的任务 ID",
        },
        removeBlockedBy: {
          type: "array",
          items: { type: "integer" },
          description: "移除依赖的任务 ID",
        },
      },
      required: ["task_id"],
    },
  },
);

const taskListTool = tool(
  () => TASKS.listAll(),
  {
    name: "task_list",
    description: "列出所有任务及状态摘要。",
    schema: {
      type: "object",
      properties: {},
    },
  },
);

const taskGetTool = tool(
  (input: { task_id: number }) => TASKS.get(input.task_id),
  {
    name: "task_get",
    description: "获取任务的完整详情。",
    schema: {
      type: "object",
      properties: {
        task_id: { type: "integer" },
      },
      required: ["task_id"],
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
  taskCreateTool,
  taskUpdateTool,
  taskListTool,
  taskGetTool,
]);

// -- 工具分发映射 --
const TOOL_HANDLERS: Record<string, (args: Record<string, any>) => string> = {
  bash: (args) => runBash(args.command),
  read_file: (args) => runRead(args.path, args.limit),
  write_file: (args) => runWrite(args.path, args.content),
  edit_file: (args) => runEdit(args.path, args.old_text, args.new_text),
  task_create: (args) => TASKS.create(args.subject, args.description),
  task_update: (args) =>
    TASKS.update(args.task_id, args.status, args.addBlockedBy ?? undefined, args.removeBlockedBy ?? undefined),
  task_list: () => TASKS.listAll(),
  task_get: (args) => TASKS.get(args.task_id),
};

// -- 系统提示 --
const SYSTEM_PROMPT = `你是工作在 ${WORKDIR} 的代码助手。使用任务工具来规划和跟踪工作。`;

// -- Agent 循环 --
const agentLoop = async (messages: BaseMessage[]) => {
  while (true) {
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
