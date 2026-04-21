/**
 * 5.skill-loading.ts - Progressive Skill Loading
 *
 * Two-layer skill loading pattern:
 *   Layer 1: Short descriptions in system prompt (always visible)
 *   Layer 2: Full content loaded on demand via skill tool
 *
 *     System prompt                      Tool call
 *     +--------------------------+      +------------------+
 *     | Available skills:        |      | skill("xyz")     |
 *     |   - xyz: description     | ---> | <skill>          |
 *     |   - abc: description     |      |   full content   |
 *     +--------------------------+      | </skill>         |
 *                                       +------------------+
 *
 * Key insight: "Don't bloat context with unused skills."
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
const SKILLS_DIR = path.join(WORKDIR, "skills");


// -- SkillLoader --
interface SkillMeta {
  name: string;
  description: string;
  version?: string;
  tags?: string;
}

interface Skill {
  meta: SkillMeta;
  body: string;
  path: string;
}

class SkillLoader {
  private skillsDir: string;
  private skills: Map<string, Skill> = new Map();

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
    this.loadAll();
  }

  private loadAll(): void {
    if (!fs.existsSync(this.skillsDir)) {
      return;
    }

    const skillFiles = this.findSkillFiles(this.skillsDir);
    for (const filePath of skillFiles.sort()) {
      const text = fs.readFileSync(filePath, "utf-8");
      const { meta, body } = this.parseFrontmatter(text);
      const name = meta.name || path.dirname(filePath).split("/").pop() || filePath;
      this.skills.set(name, { meta, body, path: filePath });
    }
  }

  private findSkillFiles(dir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.findSkillFiles(fullPath));
      } else if (entry.name === "SKILL.md") {
        results.push(fullPath);
      }
    }
    console.log("找到的skill文件:", results);
    return results;
  }

  private parseFrontmatter(text: string): { meta: SkillMeta; body: string } {
    const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
      return { meta: { name: "", description: "No description" }, body: text };
    }

    const meta: SkillMeta = { name: "", description: "No description" };
    // Simple YAML parsing for key-value pairs
    const yamlContent = match[1]!;
    const lines = yamlContent.split("\n");
    const parsed: Record<string, string> = {};

    for (const line of lines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim().replace(/^["']|["']$/g, "");
        parsed[key] = value;
      }
    }

    meta.name = parsed.name || "";
    meta.description = parsed.description || "No description";
    if (parsed.version) meta.version = parsed.version;
    if (parsed.tags) meta.tags = parsed.tags;

    return { meta, body: match[2]!.trim() };
  }

  getDescriptions(): string {
    /** Layer 1: short descriptions for the system prompt. */
    if (this.skills.size === 0) {
      return "(no skills available)";
    }

    const lines: string[] = [];
    for (const [name, skill] of this.skills) {
      const desc = skill.meta.description || "No description";
      let line = `  - ${name}: ${desc}`;
      if (skill.meta.tags) {
        line += ` [${skill.meta.tags}]`;
      }
      lines.push(line);
    }
    console.log("获取所有skill的描述信息:", lines);
    return lines.join("\n");
  }

  getContent(name: string): string {
    /** Layer 2: full skill body returned in tool_result. */
    console.log("获取skill内容: " + name);
    const skill = this.skills.get(name);
    if (!skill) {
      return `Error: Unknown skill '${name}'. Available: ${Array.from(this.skills.keys()).join(", ")}`;
    }
    return `<skill name="${name}">\n${skill.body}\n</skill>`;
  }

  listSkills(): string[] {
    return Array.from(this.skills.keys());
  }
}

// Initialize SkillLoader
const skillLoader = new SkillLoader(SKILLS_DIR);

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

// Skill tool for loading skills on demand
const skillTool = tool(
  (input: { name: string }) => skillLoader.getContent(input.name),
  {
    name: "skill",
    description: "Load a skill by name. Returns the full skill content.",
    schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the skill to load",
        },
      },
      required: ["name"],
    },
  },
);

// -- LLM setup --
const llm = new ChatOpenAI({
  model: "qwen-plus",
  temperature: 0.5,
  maxTokens: 8000,
});

// LLM with tools including skill
const llmWithTools = llm.bindTools([bashTool, readTool, writeTool, editTool, skillTool]);

// -- Tool dispatch map --
const TOOL_HANDLERS: Record<string, (args: Record<string, any>) => string> = {
  bash: (args) => runBash(args.command),
  read_file: (args) => runRead(args.path, args.limit),
  write_file: (args) => runWrite(args.path, args.content),
  edit_file: (args) => runEdit(args.path, args.old_text, args.new_text),
  skill: (args) => skillLoader.getContent(args.name),
};

// -- System prompt with skill descriptions --
const SYSTEM_PROMPT = `You are a coding agent at ${WORKDIR}.
Use load_skill to access specialized knowledge before tackling unfamiliar topics.

Skills available:
${skillLoader.getDescriptions()}`

// -- Agent loop --
const agentLoop = async (messages: BaseMessage[]) => {
  while (true) {
    const messagesWithSystem = [
      new SystemMessage({ content: SYSTEM_PROMPT }),
      ...messages,
    ];

    const response = await llmWithTools.invoke(messagesWithSystem);
    log(`LLM Response: ${JSON.stringify(response, null, 2)}`);
    messages.push(response);

    if (response.response_metadata?.finish_reason !== "tool_calls") {
      return;
    }

    const results: ToolMessage[] = [];

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
  newLogFile(); // 会话开始时创建一个日志文件

  while (true) {
    try {
      const query = await question("\x1b[36ms05 >> \x1b[0m");
      const cmd = query.trim().toLowerCase();
      if (cmd === "q" || cmd === "exit" || cmd === "") {
        break;
      }
      history.push(new HumanMessage({ content: query }));
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
