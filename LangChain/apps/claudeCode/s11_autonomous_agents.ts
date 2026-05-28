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
import { execSync, spawn } from "child_process";
import * as readline from "readline";
import { v7 as uuid7 } from "uuid";
import {
  log,
  setLogFile,
  ensureTeamsLogsDir,
  TEAMS_LOGS_DIR,
  logStart,
  logStop,
  logMsg,
  logTool,
  logLLM,
  logError,
  logStatus,
  logLoop,
} from "./utils/logger.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);

dotenv.config();
const WORKDIR = process.cwd();
// -- 系统提示 --
const SYSTEM_PROMPT = `您是 {WORKDIR} 的团队负责人。创建团队成员并通过收件箱进行沟通。`;
const TEAM_DIR = path.join(WORKDIR, ".team");
const INBOX_DIR = path.join(TEAM_DIR, "inbox");
const CONFIG_PATH = path.join(TEAM_DIR, "config.json");
const REQUESTS_PATH = path.join(TEAM_DIR, "requests.json");
const TASKS_DIR = path.join(WORKDIR, ".tasks");
const POLL_INTERVAL = 5000; // 5秒
const IDLE_TIMEOUT = 60000; // 60秒
const VALID_MSG_TYPES = [
  "message",
  "broadcast",
  "shutdown_request",
  "shutdown_response",
  "plan_approval_response",
];
// 请求跟踪器：按 request_id 进行关联（持久化到文件）
let shutdownRequests: Record<string, any> = {};
let planRequests: Record<string, any> = {};

// 加载请求状态
function loadRequests(): void {
  try {
    if (fs.existsSync(REQUESTS_PATH)) {
      const data = JSON.parse(fs.readFileSync(REQUESTS_PATH, "utf-8"));
      shutdownRequests = data.shutdownRequests || {};
      planRequests = data.planRequests || {};
    }
  } catch (e) {
    // 文件不存在或解析错误，使用默认空对象
  }
}

// 保存请求状态
function saveRequests(): void {
  fs.writeFileSync(REQUESTS_PATH, JSON.stringify({ shutdownRequests, planRequests }, null, 2));
}

// -- LLM 配置 --
const llm = new ChatOpenAI({
  model: "qwen-plus",
  temperature: 0.5,
  maxTokens: 8000,
});

// -- MessageBus: 每个队友一个 JSONL 收件箱 --
class MessageBus {
  dir: string;
  constructor(inboxDir: string) {
    this.dir = inboxDir;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  send(
    sender: string,
    to: string,
    content: string,
    msgType = "message",
    extra?: Record<string, unknown>,
  ): string {
    if (!VALID_MSG_TYPES.includes(msgType)) {
      return `错误: 无效的消息类型 '${msgType}'。有效类型: ${VALID_MSG_TYPES.join("/ ")}`;
    }
    const msg: any = {
      type: msgType,
      from: sender,
      content: content,
      timestamp: Date.now(),
    };
    if (extra) {
      msg.extra = extra;
    }
    const msgPath = path.join(this.dir, `${to}.jsonl`);
    fs.appendFileSync(msgPath, JSON.stringify(msg) + "\n");
    return `消息已发送到 ${to} 的收件箱`;
  }

  readInbox(name: string): any[] {
    const msgPath = path.join(this.dir, `${name}.jsonl`);
    if (!fs.existsSync(msgPath)) {
      return [];
    }
    const content = fs.readFileSync(msgPath, "utf-8");
    const lines = content.trim().split("\n").filter(line => line);
    // 清空收件箱
    fs.writeFileSync(msgPath, "");
    return lines.map((line) => JSON.parse(line));
  }

  broadcast(sender: string, content: string, teammates: string[]): string {
    let count = 0;
    for (const name of teammates) {
      if (name !== sender) {
        this.send(sender, name, content, "broadcast");
        count++;
      }
    }
    return `已向 ${count} 位队友广播消息`;
  }
}

const BUS = new MessageBus(INBOX_DIR);

// -- Task board scanning --
function scanUnclaimedTasks(): any[] {
  if (!fs.existsSync(TASKS_DIR)) {
    fs.mkdirSync(TASKS_DIR, { recursive: true });
    return [];
  }
  const unclaimed: any[] = [];
  const files = fs.readdirSync(TASKS_DIR).filter(f => f.startsWith("task_") && f.endsWith(".json")).sort();
  for (const f of files) {
    const task = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), "utf-8"));
    if (task.status === "pending" && !task.owner && !task.blockedBy) {
      unclaimed.push(task);
    }
  }
  return unclaimed;
}

function claimTask(taskId: number, owner: string): string {
  const taskPath = path.join(TASKS_DIR, `task_${taskId}.json`);
  if (!fs.existsSync(taskPath)) {
    return `错误: 任务 ${taskId} 未找到`;
  }
  const task = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
  if (task.owner) {
    return `错误: 任务 ${taskId} 已被 ${task.owner} 认领`;
  }
  if (task.status !== "pending") {
    return `错误: 任务 ${taskId} 状态为 '${task.status}'，无法认领`;
  }
  if (task.blockedBy) {
    return `错误: 任务 ${taskId} 被其他任务阻塞，暂时无法认领`;
  }
  task.owner = owner;
  task.status = "in_progress";
  fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
  return `已为 ${owner} 认领任务 #${taskId}`;
}

// Identity re-injection after compression
function makeIdentityBlock(name: string, role: string, teamName: string): string {
  return `<identity>你是 '${name}'，角色: ${role}，团队: ${teamName}。继续你的工作。</identity>`;
}

// -- TeammateManager: 使用 config.json 进行持久化命名agent  --
class TeammateManager {
  dir: string;
  configPath: string;
  config: any;
  threads: Record<string, any>;
  constructor(teamDir: string) {
    this.dir = teamDir;
    fs.mkdirSync(this.dir, { recursive: true });
    this.configPath = path.join(CONFIG_PATH);
    this.config = this.loadConfig();
    this.threads = {};
  }
  private loadConfig(): Record<string, any> {
    if (fs.existsSync(this.configPath)) {
      const configContent = fs.readFileSync(this.configPath, "utf-8");
      return JSON.parse(configContent);
    }
    return { team_name: "default", members: [] };
  }
  private saveConfig() {
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }

  private findMember(name: string): Record<string, any> | undefined {
    return this.config.members.find((m: any) => m.name === name);
  }

  updateStatus(name: string, status: string): boolean {
    const member = this.findMember(name);
    if (member) {
      member.status = status;
      this.saveConfig();
      return true;
    }
    return false;
  }

  spawn(name: string, role: string, prompt: string): string {
    const member = this.findMember(name);
    if (member) {
      if (!["idle", "shutdown"].includes(member.status)) {
        return `错误: '${name}' 当前状态为 ${member.status}`;
      }
      member.status = "working";
      member.role = role;
    } else {
      const newMember = { name, role, status: "working" };
      this.config.members.push(newMember);
    }
    this.saveConfig();

    // 启动队友线程
    // 使用 tsx 运行 TypeScript 文件
    const thread = spawn(
      "npx",
      ["tsx", "--env-file=.env", __filename, name, role, prompt],
      {
        cwd: WORKDIR,
        detached: true,
        stdio: "inherit", // 继承 stdio 以便调试
      },
    );
    thread.unref();
    this.threads[name] = thread;

    return `已生成 '${name}' (角色: ${role})`;
  }

  async teammateLoop(name: string, role: string, prompt: string) {
    // 创建 teammate 专属日志文件（在teams目录下）
    ensureTeamsLogsDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logPath = path.join(TEAMS_LOGS_DIR, `${name}-${timestamp}.log`);
    setLogFile(logPath);
    logStart(`Teammate ${name} (role: ${role}) started`);

    const teamName = this.config.team_name;
    const sysPrompt = `你是一个名为 '${name}' 的队友，角色: ${role}，团队: ${teamName}，工作目录: ${WORKDIR}。使用 idle 工具表示你暂时没有工作。你将自动认领新任务。`;
    const messages: BaseMessage[] = [new HumanMessage(prompt)];
    log(`Initial prompt: ${prompt}`, "info");
    // -- 工具定义 --
    const tools = this.teammateTools();

    while (true) {
      // -- WORK PHASE: 标准 agent 循环 --
      for (let i = 0; i < 50; i++) {
        const inbox: any[] = BUS.readInbox(name);
        for (const msg of inbox) {
          if (msg.type === "shutdown_request") {
            this.updateStatus(name, "shutdown");
            logStop(name + "收到关机请求");
            return;
          }
          messages.push(new HumanMessage(JSON.stringify(msg)));
        }
        // -- 调用LLM --
        let response: any;
        try {
          response = await llm
            .bindTools(tools)
            .invoke([new SystemMessage(sysPrompt), ...messages]);
        } catch (error) {
          logError(`LLM error: ${error}`);
          this.updateStatus(name, "idle");
          return;
        }
        // -- 处理工具调用 --
        logLLM(`Response: ${JSON.stringify(response, null, 2).slice(0, 2000)}`);
        messages.push(new AIMessage(response.content));
        if (response.response_metadata?.finish_reason !== "tool_calls") {
          logLoop(`Ended: finish_reason=${response.response_metadata?.finish_reason}`);
          break;
        }
        // 执行工具
        const results: ToolMessage[] = [];
        let idleRequested = false;
        if (response.tool_calls) {
          for (const call of response.tool_calls) {
            let result: string;
            if (call.name === "idle") {
              idleRequested = true;
              result = "进入空闲阶段。将轮询新任务。";
            } else {
              result = this.exec(name, call.name, call.args);
            }
            logTool(`${call.name}: ${String(result).slice(0, 500)}`);
            console.log(`  [${name}] ${call.name}: ${String(result).slice(0, 120)}`);
            results.push(
              new ToolMessage({
                tool_call_id: call.id,
                content: String(result),
              }),
            );
            // 如果批准关机，直接退出
            if (call.name === "shutdown_response" && call.args.approve) {
              this.updateStatus(name, "shutdown");
              logStop(name + "已批准关机");
              return;
            }
          }
        }
        messages.push(...results);
        if (idleRequested) {
          break;
        }
      }

      // -- IDLE PHASE: 轮询收件箱和未认领任务 --
      this.updateStatus(name, "idle");
      let resume = false;
      const polls = Math.ceil(IDLE_TIMEOUT / Math.max(POLL_INTERVAL, 1));
      for (let i = 0; i < polls; i++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
        const inbox = BUS.readInbox(name);
        if (inbox.length > 0) {
          for (const msg of inbox) {
            if (msg.type === "shutdown_request") {
              this.updateStatus(name, "shutdown");
              logStop(name + "收到关机请求");
              return;
            }
            messages.push(new HumanMessage(JSON.stringify(msg)));
          }
          resume = true;
          break;
        }
        const unclaimed = scanUnclaimedTasks();
        if (unclaimed.length > 0) {
          const task = unclaimed[0];
          const claimResult = claimTask(task.id, name);
          if (claimResult.startsWith("错误")) {
            continue;
          }
          const taskPrompt = `<auto-claimed>任务 #${task.id}: ${task.subject}\n${task.description || ""}</auto-claimed>`;
          // 身份重注入
          if (messages.length <= 3) {
            const identityBlock = makeIdentityBlock(name, role, teamName);
            messages.unshift(new HumanMessage(identityBlock));
            messages.splice(1, 0, new AIMessage(`我是 ${name}。继续工作。`));
          }
          messages.push(new HumanMessage(taskPrompt));
          messages.push(new AIMessage(`已认领任务 #${task.id}。开始处理。`));
          resume = true;
          break;
        }
      }

      if (!resume) {
        this.updateStatus(name, "shutdown");
        logStop(name + "空闲超时");
        return;
      }
      this.updateStatus(name, "working");
    }
  }

  exec(sender: string, toolName: string, args: Record<string, any>): string {
    // 这些基础工具与 s02 中的相同
    if (toolName === "bash") {
      return runBash(args.command);
    }
    if (toolName === "read_file") {
      return runRead(args.path);
    }
    if (toolName === "write_file") {
      return runWrite(args.path, args.content);
    }
    if (toolName === "edit_file") {
      return runEdit(args.path, args.old_text, args.new_text);
    }
    if (toolName === "send_message") {
      return BUS.send(
        sender,
        args.to,
        args.content,
        args.msg_type || "message",
      );
    }
    if (toolName === "read_inbox") {
      return JSON.stringify(BUS.readInbox(sender), null, 2);
    }
    if (toolName === "shutdown_response") {
      const reqId = args.request_id;
      const approve = args.approve;
      const reason = args.reason || "";
      // 更新请求状态
      loadRequests();
      if (reqId in shutdownRequests) {
        shutdownRequests[reqId].status = approve ? "approved" : "rejected";
        saveRequests();
      }
      // 发送关机响应给lead
      BUS.send(sender, "lead", reason, "shutdown_response", {
        request_id: reqId,
        approve: approve,
      });
      return `关机${approve ? "已批准" : "已拒绝"}`;
    }
    if (toolName === "plan_approval") {
      const planText = args.plan || "";
      const reqId = uuid7().slice(0, 8);
      // 更新请求状态
      loadRequests();
      planRequests[reqId] = { from: sender, plan: planText, status: "pending" };
      saveRequests();
      // 发送计划审批请求给lead
      BUS.send(sender, "lead", planText, "plan_approval_response", {
        request_id: reqId,
        plan: planText,
      });
      return `计划已提交 (request_id=${reqId})。等待负责人审批。`;
    }
    if (toolName === "idle") {
      return "进入空闲阶段。将轮询新任务。";
    }
    if (toolName === "claim_task") {
      return claimTask(args.task_id, sender);
    }
    return `未知工具: ${toolName}`;
  }

  teammateTools(): any[] {
    return [
      {
        name: "bash",
        description: "Run a shell command.",
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
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
      {
        name: "write_file",
        description: "Write content to file.",
        input_schema: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
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
        name: "send_message",
        description: "Send message to a teammate.",
        input_schema: {
          type: "object",
          properties: {
            to: { type: "string" },
            content: { type: "string" },
            msg_type: { type: "string", enum: VALID_MSG_TYPES },
          },
          required: ["to", "content"],
        },
      },
      {
        name: "read_inbox",
        description: "Read and drain your inbox.",
        input_schema: { type: "object", properties: {} },
      },
      {
        name: "shutdown_response",
        description:
          "Respond to a shutdown request. Approve to shut down, reject to keep working.",
        input_schema: {
          type: "object",
          properties: {
            request_id: { type: "string" },
            approve: { type: "boolean" },
            reason: { type: "string" },
          },
          required: ["request_id", "approve"],
        },
      },
      {
        name: "plan_approval",
        description: "Submit a plan for lead approval. Provide plan text.",
        input_schema: {
          type: "object",
          properties: {
            plan: { type: "string" },
          },
          required: ["plan"],
        },
      },
      {
        name: "idle",
        description: "Signal that you have no more work. Enters idle polling phase.",
        input_schema: { type: "object", properties: {} },
      },
      {
        name: "claim_task",
        description: "Claim a task from the task board by ID.",
        input_schema: {
          type: "object",
          properties: {
            task_id: { type: "integer" },
          },
          required: ["task_id"],
        },
      },
    ];
  }

  listAll(): string {
    if (this.config.members.length === 0) {
      return "暂无队友";
    }
    return this.config.members
      .map((m: any) => `name: ${m.name}, role: ${m.role}, status: ${m.status}`)
      .join("\n");
  }

  memberNames(): string[] {
    return this.config.members.map((m: any) => m.name);
  }
}

const TEAM = new TeammateManager(TEAM_DIR);

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

const spawnTeammateTool = tool(
  (input: { name: string; role: string; prompt: string }) =>
    TEAM.spawn(input.name, input.role, input.prompt),
  {
    name: "spawn_teammate",
    description: "生成一个持久化的队友，它会在自己的线程中运行。",
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        role: { type: "string" },
        prompt: { type: "string" },
      },
      required: ["name", "role", "prompt"],
    },
  },
);
const listTeammatesTool = tool(() => TEAM.listAll(), {
  name: "list_teammates",
  description: "列出所有队友的姓名、角色和状态。",
  schema: {
    type: "object",
    properties: {},
  },
});
const sendMessageTool = tool(
  (input: { to: string; content: string; msg_type?: string }) =>
    BUS.send("lead", input.to, input.content, input.msg_type),
  {
    name: "send_message",
    description: "发送消息给队友的收件箱。",
    schema: {
      type: "object",
      properties: {
        to: { type: "string" },
        content: { type: "string" },
        msg_type: { type: "string", enum: VALID_MSG_TYPES },
      },
      required: ["to", "content"],
    },
  },
);
const readInboxTool = tool(
  () => JSON.stringify(BUS.readInbox("lead"), null, 2),
  {
    name: "read_inbox",
    description: "阅读并清空 lead 的收件箱。",
    schema: {
      type: "object",
      properties: {},
    },
  },
);
const broadcastTool = tool(
  (input: { content: string }) => {
    BUS.broadcast("lead", input.content, TEAM.memberNames());
    return "已广播消息";
  },
  {
    name: "broadcast",
    description: "向所有队友发送消息。",
    schema: {
      type: "object",
      properties: {
        content: { type: "string" },
      },
      required: ["content"],
    },
  },
);

// -- Lead-specific protocol handlers --
// Lead端的协议处理函数（纯逻辑，不含tool包装）
function handleShutdownRequestLogic(teammate: string): string {
  loadRequests();
  const reqId = Math.random().toString(36).substring(2, 10);
  shutdownRequests[reqId] = { target: teammate, status: "pending" };
  saveRequests();
  BUS.send("lead", teammate, "请优雅地关闭。", "shutdown_request", { request_id: reqId });
  return `关机请求 ${reqId} 已发送给 '${teammate}' (状态: pending)`;
}

function checkShutdownStatusLogic(requestId: string): string {
  loadRequests();
  return JSON.stringify(shutdownRequests[requestId] || { error: "not found" });
}

function handlePlanReviewLogic(requestId: string, approve: boolean, feedback: string = ""): string {
  loadRequests();
  const req = planRequests[requestId];
  if (!req) return `错误: 未知的计划请求ID '${requestId}'`;
  req.status = approve ? "approved" : "rejected";
  saveRequests();
  BUS.send("lead", req.from, feedback, "plan_approval_response", { request_id: requestId, approve, feedback });
  return `计划${req.status}，来自 '${req.from}'`;
}

const handleShutdownRequest = tool(
  (input: { teammate: string }) => handleShutdownRequestLogic(input.teammate),
  { name: "shutdown_request", description: "请求关闭指定队友。", schema: { type: "object", properties: { teammate: { type: "string" } }, required: ["teammate"] } }
);

const handlePlanReview = tool(
  (input: { request_id: string; approve: boolean; feedback?: string }) =>
    handlePlanReviewLogic(input.request_id, input.approve, input.feedback),
  { name: "plan_approval", description: "审批队友提交的计划。", schema: { type: "object", properties: { request_id: { type: "string" }, approve: { type: "boolean" }, feedback: { type: "string" } }, required: ["request_id", "approve"] } }
);

const checkShutdownStatus = tool(
  (input: { request_id: string }) => checkShutdownStatusLogic(input.request_id),
  { name: "shutdown_response", description: "检查关闭请求的状态。", schema: { type: "object", properties: { request_id: { type: "string" } }, required: ["request_id"] } }
);

const idleTool = tool(
  () => "负责人不会空闲。",
  { name: "idle", description: "进入空闲状态（负责人不常用）。", schema: { type: "object", properties: {} } }
);

const claimTaskTool = tool(
  (input: { task_id: number }) => claimTask(input.task_id, "lead"),
  { name: "claim_task", description: "通过ID从任务看板认领任务。", schema: { type: "object", properties: { task_id: { type: "integer" } }, required: ["task_id"] } }
);

const llmWithTools = llm.bindTools([
  bashTool,
  readTool,
  writeTool,
  editTool,
  spawnTeammateTool,
  listTeammatesTool,
  sendMessageTool,
  readInboxTool,
  broadcastTool,
  handleShutdownRequest,
  handlePlanReview,
  checkShutdownStatus,
  idleTool,
  claimTaskTool,
]);

// -- 工具分发映射 --
const TOOL_HANDLERS: Record<string, (args: Record<string, any>) => string> = {
  bash: (args) => runBash(args.command),
  read_file: (args) => runRead(args.path, args.limit),
  write_file: (args) => runWrite(args.path, args.content),
  edit_file: (args) => runEdit(args.path, args.old_text, args.new_text),
  spawn_teammate: (args) => TEAM.spawn(args.name, args.role, args.prompt),
  list_teammates: () => TEAM.listAll(),
  send_message: (args) =>
    BUS.send("lead", args.to, args.content, args.msg_type),
  read_inbox: () => JSON.stringify(BUS.readInbox("lead"), null, 2),
  broadcast: (args) => {
    BUS.broadcast("lead", args.content, TEAM.memberNames());
    return "已广播消息";
  },
  shutdown_request: (args) => handleShutdownRequestLogic(args.teammate),
  shutdown_response: (args) => checkShutdownStatusLogic(args.request_id),
  plan_approval: (args) =>
    handlePlanReviewLogic(args.request_id, args.approve, args.feedback),
  idle: () => "负责人不会空闲。",
  claim_task: (args) => claimTask(args.task_id, "lead"),
};

// -- Agent 循环 --
const agentLoop = async (messages: BaseMessage[]) => {
  while (true) {
    // 收件箱
    const inbox = BUS.readInbox("lead");
    if (inbox.length > 0) {
      logMsg(`Inbox: ${JSON.stringify(inbox, null, 2).slice(0, 1000)}`);
      messages.push(
        new HumanMessage({
          content: `<inbox>${JSON.stringify(inbox, null, 2)}</inbox>`,
        }),
      );
    }

    const messagesWithSystem = [
      new SystemMessage({ content: SYSTEM_PROMPT }),
      ...messages,
    ];

    const response = await llmWithTools.invoke(messagesWithSystem);
    logLLM(`Response: ${JSON.stringify(response, null, 2).slice(0, 2000)}`);
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

        logTool(`${toolCall.name}: ${String(output).slice(0, 500)}`);
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
  // leader日志也放在teams目录下
  ensureTeamsLogsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  setLogFile(path.join(TEAMS_LOGS_DIR, `leader-${timestamp}.log`));

  while (true) {
    try {
      const query = await question("\x1b[36ms11 >> \x1b[0m");
      const cmd = query.trim().toLowerCase();
      if (cmd === "q" || cmd === "exit") {
        break;
      }
      if (cmd === "") {
        continue; // 空输入，继续循环
      }
      if (cmd === "/team") {
        console.log(TEAM.listAll());
        continue;
      }
      if (cmd === "/inbox") {
        console.log(BUS.readInbox("lead"));
        continue;
      }
      if (cmd === "/tasks") {
        if (!fs.existsSync(TASKS_DIR)) {
          console.log("任务看板为空");
          continue;
        }
        const files = fs.readdirSync(TASKS_DIR).filter(f => f.startsWith("task_") && f.endsWith(".json")).sort();
        for (const f of files) {
          const t = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), "utf-8"));
          const marker: Record<string, string> = { pending: "[ ]", in_progress: "[>]", completed: "[x]" };
          const status = marker[t.status] || "[?]";
          const owner = t.owner ? ` @${t.owner}` : "";
          console.log(`  ${status} #${t.id}: ${t.subject}${owner}`);
        }
        continue;
      }
      history.push(new HumanMessage({ content: query }));
      logLoop(`History: ${JSON.stringify(history, null, 2).slice(0, 3000)}`);
      await agentLoop(history);
      // 打印最终响应
      const lastContent = history[history.length - 1]?.content;
      if (typeof lastContent === "string") {
        console.log(lastContent);
      }
      console.log();
      logStop(`=== 对话结束 ===`);
    } catch (error) {
      console.log(error);
      break;
    }
  }

  rl.close();
};

// 判断是 leader 还是 teammate
if (process.argv.length > 2) {
  // 作为队友进程启动: node 9.teams.ts <name> <role> <prompt>
  const args = process.argv.slice(2);
  const name = args[0]!;
  const role = args[1]!;
  const prompt = args[2]!;
  TEAM.teammateLoop(name, role, prompt).catch((e) => console.error(e));
} else {
  main();
}
