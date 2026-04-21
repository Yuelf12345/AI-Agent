/**
 * s04_subagent.ts - Subagents
 *
 * Spawn a child agent with fresh messages=[]. The child works in its own
 * context, sharing the filesystem, then returns only a summary to the parent.
 *
 *     Parent agent                     Subagent
 *     +------------------+             +------------------+
 *     | messages=[...]   |             | messages=[]      |  <-- fresh
 *     |                  |  dispatch   |                  |
 *     | tool: task       | ---------->| while tool_use:  |
 *     |   prompt="..."   |            |   call tools     |
 *     |   description="" |            |   append results |
 *     |                  |  summary   |                  |
 *     |   result = "..." | <--------- | return last text |
 *     +------------------+             +------------------+
 *               |
 *     Parent context stays clean.
 *     Subagent context is discarded.
 *
 * Key insight: "Process isolation gives context isolation for free."
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

// -- System prompts --
const SYSTEM_PROMPT = `You are a coding agent at ${WORKDIR}. Use the task tool to delegate exploration or subtasks.`;
const SUBAGENT_SYSTEM_PROMPT = `You are a coding subagent at ${WORKDIR}. Complete the given task, then summarize your findings.`;

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
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = result.toString().trim();
    return output.slice(0, 50000) || "(no output)";
  } catch (error: any) {
    const stderr = error.stderr?.toString() || "";
    const stdout = error.stdout?.toString() || "";
    const output = (stdout + stderr).trim() || error.message;
    return `Error: ${output.slice(0, 50000)}`;
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

// -- Tool definitions (shared by parent and child, except task) --
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

// Child tools: base tools only (no recursive spawning)
const CHILD_TOOLS = [bashTool, readTool, writeTool, editTool];

// Task tool for parent to spawn subagent
const taskTool = tool(
  (input: { prompt: string; description?: string }) => {
    // This is a placeholder - actual execution happens in agentLoop
    return input.prompt;
  },
  {
    name: "task",
    description:
      "Spawn a subagent with fresh context. It shares the filesystem but not conversation history.",
    schema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        description: {
          type: "string",
          description: "Short description of the task",
        },
      },
      required: ["prompt"],
    },
  },
);

// -- LLM setup --
const llm = new ChatOpenAI({
  model: "qwen-plus",
  temperature: 0.5,
  maxTokens: 8000,
});

// Child LLM with base tools only
const childLlmWithTools = llm.bindTools(CHILD_TOOLS);

// Parent LLM with all tools including task
const parentLlmWithTools = llm.bindTools([
  ...CHILD_TOOLS,
  taskTool,
]);

// -- Tool dispatch map --
const TOOL_HANDLERS: Record<string, (args: Record<string, any>) => string> = {
  bash: (args) => runBash(args.command),
  read_file: (args) => runRead(args.path, args.limit),
  write_file: (args) => runWrite(args.path, args.content),
  edit_file: (args) => runEdit(args.path, args.old_text, args.new_text),
};

// -- Subagent: fresh context, filtered tools, summary-only return --
async function runSubagent(prompt: string): Promise<string> {
  const subMessages: BaseMessage[] = [
    new HumanMessage({ content: prompt }), // fresh context
  ];

  for (let i = 0; i < 30; i++) {
    // safety limit
    const messagesWithSystem = [
      new SystemMessage({ content: SUBAGENT_SYSTEM_PROMPT }),
      ...subMessages,
    ];

    const response = await childLlmWithTools.invoke(messagesWithSystem);
    log(`[Subagent] LLM Response: ${JSON.stringify(response, null, 2)}`);
    subMessages.push(response);

    // Check if done (no more tool calls)
    if (response.response_metadata?.finish_reason !== "tool_calls") {
      break;
    }

    // Process tool calls
    if (response.tool_calls && response.tool_calls.length > 0) {
      const results: ToolMessage[] = [];

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

        log(`[Subagent] Tool ${toolCall.name}: ${output.slice(0, 200)}`);
        results.push(
          new ToolMessage({
            tool_call_id: toolCall.id!,
            content: output,
          }),
        );
      }

      subMessages.push(...results);
    }
  }

  // Only the final text returns to the parent -- child context is discarded
  const lastMessage = subMessages[subMessages.length - 1];
  if (lastMessage && typeof lastMessage.content === "string") {
    return lastMessage.content || "(no summary)";
  }
  return "(no summary)";
}

// -- Parent agent loop --
const agentLoop = async (messages: BaseMessage[]) => {
  while (true) {
    const messagesWithSystem = [
      new SystemMessage({ content: SYSTEM_PROMPT }),
      ...messages,
    ];

    const response = await parentLlmWithTools.invoke(messagesWithSystem);
    log(`[Parent] LLM Response: ${JSON.stringify(response, null, 2)}`);
    messages.push(response);

    if (response.response_metadata?.finish_reason !== "tool_calls") {
      return;
    }

    const results: ToolMessage[] = [];

    if (response.tool_calls) {
      for (const toolCall of response.tool_calls) {
        let output: string;

        if (toolCall.name === "task") {
          // Spawn subagent
          const desc = (toolCall.args.description as string) || "subtask";
          const prompt = (toolCall.args.prompt as string) || "";
          console.log(`\n> task (${desc}): ${prompt.slice(0, 80)}`);
          output = await runSubagent(prompt);
        } else {
          // Regular tool
          const handler = TOOL_HANDLERS[toolCall.name];
          try {
            output = handler
              ? handler(toolCall.args)
              : `Unknown tool: ${toolCall.name}`;
          } catch (error: any) {
            output = `Error: ${error.message}`;
          }
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
      const query = await question("\x1b[36ms04 >> \x1b[0m");
      const cmd = query.trim().toLowerCase();
      if (cmd === "q" || cmd === "exit" || cmd === "") {
        break;
      }
      history.push(new HumanMessage({ content: query }));
      newLogFile(); // new conversation, new log file
      await agentLoop(history);

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
