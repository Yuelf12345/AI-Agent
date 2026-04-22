#!/usr/bin/env npx tsx
/**
 * s12_worktree_task_isolation.ts - Worktree + Task Isolation
 *
 * Directory-level isolation for parallel task execution.
 * Tasks are the control plane and worktrees are the execution plane.
 *
 *     .tasks/task_12.json
 *       {
 *         "id": 12,
 *         "subject": "Implement auth refactor",
 *         "status": "in_progress",
 *         "worktree": "auth-refactor"
 *       }
 *
 *     .worktrees/index.json
 *       {
 *         "worktrees": [
 *           {
 *             "name": "auth-refactor",
 *             "path": ".../.worktrees/auth-refactor",
 *             "branch": "wt/auth-refactor",
 *             "task_id": 12,
 *             "status": "active"
 *           }
 *         ]
 *       }
 *
 * Key insight: "Isolate by directory, coordinate by task ID."
 */

import { ChatOpenAI } from "@langchain/openai";
import { tool } from "langchain";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
  BaseMessage,
} from "@langchain/core/messages";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import * as readline from "readline";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);

dotenv.config();
const WORKDIR = process.cwd();

// Detect git repo root
function detectRepoRoot(cwd: string): string {
  try {
    const result = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const root = result.toString().trim();
    if (fs.existsSync(root)) {
      return root;
    }
  } catch {
    // Not a git repo
  }
  return cwd;
}

const REPO_ROOT = detectRepoRoot(WORKDIR);

const SYSTEM_PROMPT = `You are a coding agent at ${WORKDIR}. 
Use task + worktree tools for multi-task work. 
For parallel or risky changes: create tasks, allocate worktree lanes, 
run commands in those lanes, then choose keep/remove for closeout. 
Use worktree_events when you need lifecycle visibility.`;

// -- EventBus: append-only lifecycle events for observability --
class EventBus {
  path: string;

  constructor(eventLogPath: string) {
    this.path = eventLogPath;
    const dir = path.dirname(this.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.path)) {
      fs.writeFileSync(this.path, "", "utf-8");
    }
  }

  emit(
    event: string,
    task?: Record<string, unknown>,
    worktree?: Record<string, unknown>,
    error?: string
  ): void {
    const payload: Record<string, unknown> = {
      event,
      ts: Date.now(),
      task: task || {},
      worktree: worktree || {},
    };
    if (error) {
      payload.error = error;
    }
    fs.appendFileSync(this.path, JSON.stringify(payload) + "\n", "utf-8");
  }

  listRecent(limit: number = 20): string {
    const n = Math.max(1, Math.min(limit, 200));
    if (!fs.existsSync(this.path)) {
      return "No events yet.";
    }
    const content = fs.readFileSync(this.path, "utf-8");
    const lines = content.trim().split("\n").filter((line) => line);
    const recent = lines.slice(-n);
    const items: unknown[] = [];
    for (const line of recent) {
      try {
        items.push(JSON.parse(line));
      } catch {
        items.push({ event: "parse_error", raw: line });
      }
    }
    return JSON.stringify(items, null, 2);
  }
}

// -- TaskManager: persistent task board with optional worktree binding --
class TaskManager {
  dir: string;
  nextId: number;

  constructor(tasksDir: string) {
    this.dir = tasksDir;
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
    this.nextId = this.maxId() + 1;
  }

  private maxId(): number {
    const ids: number[] = [];
    const files = fs.readdirSync(this.dir).filter((f) => f.startsWith("task_") && f.endsWith(".json"));
    for (const f of files) {
      try {
        const part = f.split("_")[1];
        if (part) {
          ids.push(parseInt(part.replace(".json", ""), 10));
        }
      } catch {
        // skip
      }
    }
    return ids.length > 0 ? Math.max(...ids) : 0;
  }

  private pathFor(taskId: number): string {
    return path.join(this.dir, `task_${taskId}.json`);
  }

  private load(taskId: number): Record<string, unknown> {
    const fp = this.pathFor(taskId);
    if (!fs.existsSync(fp)) {
      throw new Error(`Task ${taskId} not found`);
    }
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  }

  private save(task: Record<string, unknown>): void {
    fs.writeFileSync(this.pathFor(task.id as number), JSON.stringify(task, null, 2));
  }

  create(subject: string, description: string = ""): string {
    const task: Record<string, unknown> = {
      id: this.nextId,
      subject,
      description,
      status: "pending",
      owner: "",
      worktree: "",
      blockedBy: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    this.save(task);
    this.nextId++;
    return JSON.stringify(task, null, 2);
  }

  get(taskId: number): string {
    return JSON.stringify(this.load(taskId), null, 2);
  }

  exists(taskId: number): boolean {
    return fs.existsSync(this.pathFor(taskId));
  }

  update(taskId: number, status?: string, owner?: string): string {
    const task = this.load(taskId);
    if (status) {
      if (!["pending", "in_progress", "completed"].includes(status)) {
        throw new Error(`Invalid status: ${status}`);
      }
      task.status = status;
    }
    if (owner !== undefined) {
      task.owner = owner;
    }
    task.updated_at = Date.now();
    this.save(task);
    return JSON.stringify(task, null, 2);
  }

  bindWorktree(taskId: number, worktree: string, owner: string = ""): string {
    const task = this.load(taskId);
    task.worktree = worktree;
    if (owner) {
      task.owner = owner;
    }
    if (task.status === "pending") {
      task.status = "in_progress";
    }
    task.updated_at = Date.now();
    this.save(task);
    return JSON.stringify(task, null, 2);
  }

  unbindWorktree(taskId: number): string {
    const task = this.load(taskId);
    task.worktree = "";
    task.updated_at = Date.now();
    this.save(task);
    return JSON.stringify(task, null, 2);
  }

  listAll(): string {
    const files = fs.readdirSync(this.dir)
      .filter((f) => f.startsWith("task_") && f.endsWith(".json"))
      .sort();
    const tasks: Record<string, unknown>[] = [];
    for (const f of files) {
      tasks.push(JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf-8")));
    }
    if (tasks.length === 0) {
      return "No tasks.";
    }
    const lines: string[] = [];
    const marker: Record<string, string> = {
      pending: "[ ]",
      in_progress: "[>]",
      completed: "[x]",
    };
    for (const t of tasks) {
      const status = t.status as string;
      const m = marker[status] || "[?]";
      const owner = t.owner ? ` owner=${t.owner}` : "";
      const wt = t.worktree ? ` wt=${t.worktree}` : "";
      lines.push(`${m} #${t.id}: ${t.subject}${owner}${wt}`);
    }
    return lines.join("\n");
  }
}

// Initialize managers
const TASKS = new TaskManager(path.join(REPO_ROOT, ".tasks"));
const EVENTS = new EventBus(path.join(REPO_ROOT, ".worktrees", "events.jsonl"));

// -- WorktreeManager: create/list/run/remove git worktrees + lifecycle index --
class WorktreeManager {
  repoRoot: string;
  tasks: TaskManager;
  events: EventBus;
  dir: string;
  indexPath: string;
  gitAvailable: boolean;

  constructor(repoRoot: string, tasks: TaskManager, events: EventBus) {
    this.repoRoot = repoRoot;
    this.tasks = tasks;
    this.events = events;
    this.dir = path.join(repoRoot, ".worktrees");
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
    this.indexPath = path.join(this.dir, "index.json");
    if (!fs.existsSync(this.indexPath)) {
      fs.writeFileSync(this.indexPath, JSON.stringify({ worktrees: [] }, null, 2));
    }
    this.gitAvailable = this.isGitRepo();
  }

  private isGitRepo(): boolean {
    try {
      const result = execSync("git rev-parse --is-inside-work-tree", {
        cwd: this.repoRoot,
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return result.toString().trim() === "true";
    } catch {
      return false;
    }
  }

  private runGit(args: string[]): string {
    if (!this.gitAvailable) {
      throw new Error("Not in a git repository. worktree tools require git.");
    }
    try {
      const result = execSync(`git ${args.join(" ")}`, {
        cwd: this.repoRoot,
        encoding: "utf-8",
        timeout: 120000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return (result.toString().trim() || "(no output)");
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      const output = (err.stdout?.toString() || "") + (err.stderr?.toString() || "");
      throw new Error(output.trim() || `git ${args.join(" ")} failed`);
    }
  }

  private loadIndex(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(this.indexPath, "utf-8"));
  }

  private saveIndex(data: Record<string, unknown>): void {
    fs.writeFileSync(this.indexPath, JSON.stringify(data, null, 2));
  }

  private find(name: string): Record<string, unknown> | undefined {
    const idx = this.loadIndex();
    const worktrees = idx.worktrees as Record<string, unknown>[];
    return worktrees.find((wt) => wt.name === name);
  }

  private validateName(name: string): void {
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(name || "")) {
      throw new Error("Invalid worktree name. Use 1-40 chars: letters, numbers, ., _, -");
    }
  }

  create(name: string, taskId?: number, baseRef: string = "HEAD"): string {
    this.validateName(name);
    if (this.find(name)) {
      throw new Error(`Worktree '${name}' already exists in index`);
    }
    if (taskId !== undefined && !this.tasks.exists(taskId)) {
      throw new Error(`Task ${taskId} not found`);
    }

    const wtPath = path.join(this.dir, name);
    const branch = `wt/${name}`;

    this.events.emit(
      "worktree.create.before",
      taskId !== undefined ? { id: taskId } : {},
      { name, base_ref: baseRef }
    );

    try {
      this.runGit(["worktree", "add", "-b", branch, wtPath, baseRef]);

      const entry: Record<string, unknown> = {
        name,
        path: wtPath,
        branch,
        task_id: taskId,
        status: "active",
        created_at: Date.now(),
      };

      const idx = this.loadIndex();
      (idx.worktrees as unknown[]).push(entry);
      this.saveIndex(idx);

      if (taskId !== undefined) {
        this.tasks.bindWorktree(taskId, name);
      }

      this.events.emit(
        "worktree.create.after",
        taskId !== undefined ? { id: taskId } : {},
        { name, path: wtPath, branch, status: "active" }
      );

      return JSON.stringify(entry, null, 2);
    } catch (e: unknown) {
      const err = e as Error;
      this.events.emit(
        "worktree.create.failed",
        taskId !== undefined ? { id: taskId } : {},
        { name, base_ref: baseRef },
        err.message
      );
      throw err;
    }
  }

  listAll(): string {
    const idx = this.loadIndex();
    const wts = idx.worktrees as Record<string, unknown>[];
    if (wts.length === 0) {
      return "No worktrees in index.";
    }
    const lines: string[] = [];
    for (const wt of wts) {
      const taskId = wt.task_id;
      const suffix = taskId ? ` task=${taskId}` : "";
      lines.push(
        `[${wt.status || "unknown"}] ${wt.name} -> ${wt.path} (${wt.branch || "-"})${suffix}`
      );
    }
    return lines.join("\n");
  }

  status(name: string): string {
    const wt = this.find(name);
    if (!wt) {
      return `Error: Unknown worktree '${name}'`;
    }
    const wtPath = wt.path as string;
    if (!fs.existsSync(wtPath)) {
      return `Error: Worktree path missing: ${wtPath}`;
    }
    try {
      const result = execSync("git status --short --branch", {
        cwd: wtPath,
        encoding: "utf-8",
        timeout: 60000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const text = result.toString().trim();
      return text || "Clean worktree";
    } catch (error: unknown) {
      const err = error as Error;
      return `Error: ${err.message}`;
    }
  }

  run(name: string, command: string): string {
    const dangerous = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];
    if (dangerous.some((d) => command.includes(d))) {
      return "Error: Dangerous command blocked";
    }

    const wt = this.find(name);
    if (!wt) {
      return `Error: Unknown worktree '${name}'`;
    }
    const wtPath = wt.path as string;
    if (!fs.existsSync(wtPath)) {
      return `Error: Worktree path missing: ${wtPath}`;
    }

    try {
      const result = execSync(command, {
        cwd: wtPath,
        encoding: "utf-8",
        timeout: 300000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const output = (result.toString() || "").trim();
      return output.slice(0, 50000) || "(no output)";
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      const output = ((err.stdout?.toString() || "") + (err.stderr?.toString() || "")).trim();
      return `Error: ${output.slice(0, 50000) || err.message}`;
    }
  }

  remove(name: string, force: boolean = false, completeTask: boolean = false): string {
    const wt = this.find(name);
    if (!wt) {
      return `Error: Unknown worktree '${name}'`;
    }

    this.events.emit(
      "worktree.remove.before",
      wt.task_id !== undefined ? { id: wt.task_id } : {},
      { name, path: wt.path }
    );

    try {
      const args = ["worktree", "remove"];
      if (force) {
        args.push("--force");
      }
      args.push(wt.path as string);
      this.runGit(args);

      if (completeTask && wt.task_id !== undefined) {
        const taskId = wt.task_id as number;
        const before = JSON.parse(this.tasks.get(taskId));
        this.tasks.update(taskId, "completed");
        this.tasks.unbindWorktree(taskId);
        this.events.emit(
          "task.completed",
          { id: taskId, subject: before.subject, status: "completed" },
          { name }
        );
      }

      const idx = this.loadIndex();
      for (const item of idx.worktrees as Record<string, unknown>[]) {
        if (item.name === name) {
          item.status = "removed";
          item.removed_at = Date.now();
        }
      }
      this.saveIndex(idx);

      this.events.emit(
        "worktree.remove.after",
        wt.task_id !== undefined ? { id: wt.task_id } : {},
        { name, path: wt.path, status: "removed" }
      );

      return `Removed worktree '${name}'`;
    } catch (e: unknown) {
      const err = e as Error;
      this.events.emit(
        "worktree.remove.failed",
        wt.task_id !== undefined ? { id: wt.task_id } : {},
        { name, path: wt.path },
        err.message
      );
      throw err;
    }
  }

  keep(name: string): string {
    const wt = this.find(name);
    if (!wt) {
      return `Error: Unknown worktree '${name}'`;
    }

    const idx = this.loadIndex();
    let kept: Record<string, unknown> | null = null;
    for (const item of idx.worktrees as Record<string, unknown>[]) {
      if (item.name === name) {
        item.status = "kept";
        item.kept_at = Date.now();
        kept = item;
      }
    }
    this.saveIndex(idx);

    this.events.emit(
      "worktree.keep",
      wt.task_id !== undefined ? { id: wt.task_id } : {},
      { name, path: wt.path, status: "kept" }
    );

    return kept ? JSON.stringify(kept, null, 2) : `Error: Unknown worktree '${name}'`;
  }
}

const WORKTREES = new WorktreeManager(REPO_ROOT, TASKS, EVENTS);

// -- Base tools (kept minimal) --
function safePath(p: string): string {
  const resolved = path.resolve(WORKDIR, p);
  if (!resolved.startsWith(WORKDIR)) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  return resolved;
}

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
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const output = ((err.stdout?.toString() || "") + (err.stderr?.toString() || "")).trim();
    return `Error: ${output.slice(0, 50000) || err.message}`;
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
        .concat([`... (${lines.length - limit} more)`])
        .join("\n")
        .slice(0, 50000);
    }
    return content.slice(0, 50000);
  } catch (error: unknown) {
    const err = error as Error;
    return `Error: ${err.message}`;
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
    return `Wrote ${content.length} bytes`;
  } catch (error: unknown) {
    const err = error as Error;
    return `Error: ${err.message}`;
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
  } catch (error: unknown) {
    const err = error as Error;
    return `Error: ${err.message}`;
  }
}

// -- Tool handlers --
const TOOL_HANDLERS: Record<string, (args: Record<string, unknown>) => string> = {
  bash: (args) => runBash(args.command as string),
  read_file: (args) => runRead(args.path as string, args.limit as number | undefined),
  write_file: (args) => runWrite(args.path as string, args.content as string),
  edit_file: (args) => runEdit(args.path as string, args.old_text as string, args.new_text as string),
  task_create: (args) => TASKS.create(args.subject as string, (args.description as string) || ""),
  task_list: () => TASKS.listAll(),
  task_get: (args) => TASKS.get(args.task_id as number),
  task_update: (args) => TASKS.update(args.task_id as number, args.status as string | undefined, args.owner as string | undefined),
  task_bind_worktree: (args) => TASKS.bindWorktree(args.task_id as number, args.worktree as string, (args.owner as string) || ""),
  worktree_create: (args) => WORKTREES.create(args.name as string, args.task_id as number | undefined, (args.base_ref as string) || "HEAD"),
  worktree_list: () => WORKTREES.listAll(),
  worktree_status: (args) => WORKTREES.status(args.name as string),
  worktree_run: (args) => WORKTREES.run(args.name as string, args.command as string),
  worktree_keep: (args) => WORKTREES.keep(args.name as string),
  worktree_remove: (args) => WORKTREES.remove(args.name as string, (args.force as boolean) || false, (args.complete_task as boolean) || false),
  worktree_events: (args) => EVENTS.listRecent((args.limit as number) || 20),
};

// -- Tool definitions --
const TOOLS = [
  {
    name: "bash",
    description: "Run a shell command in the current workspace (blocking).",
    input_schema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read file contents.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to file.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace exact text in file.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_text: { type: "string" },
        new_text: { type: "string" },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
  {
    name: "task_create",
    description: "Create a new task on the shared task board.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string" },
        description: { type: "string" },
      },
      required: ["subject"],
    },
  },
  {
    name: "task_list",
    description: "List all tasks with status, owner, and worktree binding.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "task_get",
    description: "Get task details by ID.",
    input_schema: {
      type: "object",
      properties: { task_id: { type: "integer" } },
      required: ["task_id"],
    },
  },
  {
    name: "task_update",
    description: "Update task status or owner.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "integer" },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed"],
        },
        owner: { type: "string" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "task_bind_worktree",
    description: "Bind a task to a worktree name.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "integer" },
        worktree: { type: "string" },
        owner: { type: "string" },
      },
      required: ["task_id", "worktree"],
    },
  },
  {
    name: "worktree_create",
    description: "Create a git worktree and optionally bind it to a task.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        task_id: { type: "integer" },
        base_ref: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "worktree_list",
    description: "List worktrees tracked in .worktrees/index.json.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "worktree_status",
    description: "Show git status for one worktree.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "worktree_run",
    description: "Run a shell command in a named worktree directory.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        command: { type: "string" },
      },
      required: ["name", "command"],
    },
  },
  {
    name: "worktree_remove",
    description: "Remove a worktree and optionally mark its bound task completed.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        force: { type: "boolean" },
        complete_task: { type: "boolean" },
      },
      required: ["name"],
    },
  },
  {
    name: "worktree_keep",
    description: "Mark a worktree as kept in lifecycle state without removing it.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "worktree_events",
    description: "List recent worktree/task lifecycle events from .worktrees/events.jsonl.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "integer" } },
    },
  },
];

// -- LLM configuration --
const llm = new ChatOpenAI({
  model: process.env.MODEL_ID || "qwen-plus",
  temperature: 0.5,
  maxTokens: 8000,
});

const llmWithTools = llm.bindTools(TOOLS);

// -- Agent loop --
const agentLoop = async (messages: BaseMessage[]) => {
  while (true) {
    const messagesWithSystem = [
      new SystemMessage({ content: SYSTEM_PROMPT }),
      ...messages,
    ];

    const response = await llmWithTools.invoke(messagesWithSystem);
    messages.push(new AIMessage(response.content));

    if (response.response_metadata?.finish_reason !== "tool_calls") {
      return;
    }

    const results: ToolMessage[] = [];

    if (response.tool_calls) {
      for (const block of response.tool_calls) {
        const handler = TOOL_HANDLERS[block.name!];
        let output: string;
        try {
          output = handler ? handler(block.args as Record<string, unknown>) : `Unknown tool: ${block.name}`;
        } catch (e: unknown) {
          const err = e as Error;
          output = `Error: ${err.message}`;
        }
        console.log(`> ${block.name}:`);
        console.log(output.slice(0, 200));
        results.push(
          new ToolMessage({
            tool_call_id: block.id!,
            content: output,
          })
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
  console.log(`Repo root for s12: ${REPO_ROOT}`);
  if (!WORKTREES.gitAvailable) {
    console.log("Note: Not in a git repo. worktree_* tools will return errors.");
  }

  const history: BaseMessage[] = [];

  while (true) {
    let query: string;
    try {
      query = await question("\x1b[36ms12 >> \x1b[0m");
    } catch {
      break;
    }

    const cmd = query.trim().toLowerCase();
    if (cmd === "q" || cmd === "exit" || cmd === "") {
      break;
    }

    history.push(new HumanMessage({ content: query }));
    await agentLoop(history);

    const lastContent = history[history.length - 1]?.content;
    if (typeof lastContent === "string") {
      console.log(lastContent);
    }
    console.log();
  }

  rl.close();
};

main();
