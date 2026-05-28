/**
 * s03_todo.ts - TodoWrite
 *
 * The model tracks its own progress via a TodoManager. A nag reminder
 * forces it to keep updating when it forgets.
 *
 *     +----------+      +-------+      +---------+
 *     |   User   | ---> |  LLM  | ---> | Tools   |
 *     |  prompt  |      |       |      | + todo  |
 *     +----------+      +---+---+      +----+----+
 *                           ^               |
 *                           |   tool_result |
 *                           +---------------+
 *                                 |
 *                     +-----------+-----------+
 *                     | TodoManager state     |
 *                     | [ ] task A            |
 *                     | [>] task B <- doing   |
 *                     | [x] task C            |
 *                     +-----------------------+
 *                                 |
 *                     if rounds_since_todo >= 3:
 *                       inject <reminder>
 *
 * Key insight: "The agent can track its own progress -- and I can see it."
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

// -- System prompt --
const SYSTEM_PROMPT = `You are a coding agent at ${WORKDIR}.
Use the todo tool to plan multi-step tasks. Mark in_progress before starting, completed when done.
Prefer tools over prose. Always answer in Chinese.`;

class TodoManager {
  items: Array<{ id: string; text: string; status: string }>;

  constructor() {
    this.items = [];
  }

  update(items: Array<{ id: string; text: string; status: string }>): string {
    if (items.length > 20) {
      throw new Error("Max 20 todos allowed");
    }
    const validated: Array<{ id: string; text: string; status: string }> = [];
    let inProgressCount = 0;
    for (let i = 0; i < items.length; i++) {
      const item: any = items[i];
      const text = String(item.text ?? "").trim();
      const status = String(item.status ?? "pending").toLowerCase();
      const itemId = String(item.id ?? String(i + 1));
      if (!text) {
        throw new Error(`Item ${itemId}: text required`);
      }
      if (!["pending", "in_progress", "completed"].includes(status)) {
        throw new Error(`Item ${itemId}: invalid status '${status}'`);
      }
      if (status === "in_progress") {
        inProgressCount++;
      }
      validated.push({ id: itemId, text, status });
    }
    if (inProgressCount > 1) {
      throw new Error("Only one task can be in_progress at a time");
    }
    this.items = validated;
    return this.render();
  }

  render(): string {
    if (this.items.length === 0) {
      return "No todos.";
    }
    const lines: string[] = [];
    for (const item of this.items) {
      const marker = { pending: "[ ]", in_progress: "[>]", completed: "[x]" }[
        item.status
      ];
      lines.push(`${marker} #${item.id}: ${item.text}`);
    }
    const done = this.items.filter((t) => t.status === "completed").length;
    lines.push(`\n(${done}/${this.items.length} completed)`);
    return lines.join("\n");
  }
}
const TODO = new TodoManager();

// -- Safe path validation --
function safePath(p: string): string {
  const resolved = path.resolve(WORKDIR, p);
  if (!resolved.startsWith(WORKDIR)) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  return resolved;
}

// -- Tool implementations --
function runBash(command: string): string {
  const dangerous = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];
  if (dangerous.some((d) => command.includes(d))) {
    return "Error: Dangerous command blocked";
  }
  try {
    const result = execSync(command, {
      cwd: WORKDIR,
      encoding: "utf-8",
      timeout: 120000,
    });
    return result.slice(0, 50000) || "(no output)";
  } catch (error: any) {
    return `Error: ${error.message}`;
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
        .concat([`... (${lines.length - limit} more lines)`])
        .join("\n")
        .slice(0, 50000);
    }
    return content.slice(0, 50000);
  } catch (error: any) {
    return `Error: ${error.message}`;
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
    return `Wrote ${content.length} bytes to ${filePath}`;
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

function runEdit(filePath: string, oldText: string, newText: string): string {
  try {
    const safe = safePath(filePath);
    const content = fs.readFileSync(safe, "utf-8");
    if (!content.includes(oldText)) {
      return `Error: Text not found in ${filePath}`;
    }
    const newContent = content.replace(oldText, newText);
    fs.writeFileSync(safe, newContent);
    return `Edited ${filePath}`;
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

// -- Tool definitions --
const bashTool = tool((input: { command: string }) => runBash(input.command), {
  name: "bash",
  description: "Run a shell command.",
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
    description: "Read file contents.",
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
    description: "Write content to file.",
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
    description: "Replace exact text in file.",
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

const todoTool = tool(
  (input: { items: Array<{ id: string; text: string; status: string }> }) =>
    TODO.update(input.items),
  {
    name: "todo",
    description: "Update task list. Track progress on multi-step tasks.",
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              text: { type: "string" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
              },
            },
            required: ["id", "text", "status"],
          },
        },
      },
      required: ["items"],
    },
  },
);

// -- LLM setup --
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
  todoTool,
]);

// -- Tool dispatch map --
const TOOL_HANDLERS: Record<string, (args: Record<string, any>) => string> = {
  bash: (args) => runBash(args.command),
  read_file: (args) => runRead(args.path, args.limit),
  write_file: (args) => runWrite(args.path, args.content),
  edit_file: (args) => runEdit(args.path, args.old_text, args.new_text),
  todo: (args) => TODO.update(args.items),
};

const agentLoop = async (messages: BaseMessage[]) => {
  let roundsSinceTodo = 0;

  while (true) {
    const messagesWithSystem = [
      new SystemMessage({ content: SYSTEM_PROMPT }),
      ...messages,
    ];
    const response = await llmWithTools.invoke(messagesWithSystem);
    console.log("response", response.content);
    log(`LLM Response: ${JSON.stringify(response, null, 2)}`);
    messages.push(response);
    if (response.response_metadata?.finish_reason !== "tool_calls") {
      return;
    }

    const results: (ToolMessage | HumanMessage)[] = [];
    let usedTodo = false;

    if (response.tool_calls) {
      for (const toolCall of response.tool_calls) {
        const handler = TOOL_HANDLERS[toolCall.name];
        let output: string;

        try {
          output = handler
            ? handler(toolCall.args)
            : `Unknown tool: ${toolCall.name}`;
        } catch (error: any) {
          output = `Error: ${error.message}`;
        }
        results.push(
          new ToolMessage({
            tool_call_id: toolCall.id!,
            content: output,
          }),
        );

        if (toolCall.name === "todo") {
          usedTodo = true;
        }
      }
    }

    roundsSinceTodo = usedTodo ? 0 : roundsSinceTodo + 1;

    if (roundsSinceTodo >= 3) {
      results.push(
        new HumanMessage({
          content: "<reminder>Update your todos.</reminder>",
        }),
      );
    }

    messages.push(...results);
  }
};

// -- REPL main loop --
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (prompt: string): Promise<string> => {
  return new Promise((resolve) => rl.question(prompt, resolve));
};

const main = async () => {
  const history: BaseMessage[] = [];

  while (true) {
    try {
      const query = await question("\x1b[36ms03 >> \x1b[0m");
      const cmd = query.trim().toLowerCase();
      if (cmd === "q" || cmd === "exit" || cmd === "") {
        break;
      }
      history.push(new HumanMessage({ content: query }));
      newLogFile(); // 新对话，新日志文件
      await agentLoop(history);
      log(`History: ${JSON.stringify(history, null, 2)}`);
      // Print final response
      const lastContent = history[history.length - 1]?.content;
      if (typeof lastContent === "string") {
        console.log(lastContent);
      }
      console.log();
    } catch (error) {
      console.log(error);

      break;
    }
  }

  rl.close();
};

main();
