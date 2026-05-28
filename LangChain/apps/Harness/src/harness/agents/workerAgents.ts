/**
 * Worker Agent - 知识管理领域的专业化子 Agent
 *
 * 每个 Worker Agent 有明确的能力边界和工具集，
 * 由 Planner 分配、Supervisor 监控执行。
 *
 * 四个 Worker：
 *   NoteAgent    — 笔记管理（创建、搜索、编辑笔记）
 *   TaskAgent    — 待办管理（提取、创建、管理待办事项）
 *   SearchAgent  — 知识搜索（搜索笔记和本地知识库）
 *   FileAgent    — 文件管理（读取、编辑文件）
 */

import { BaseAgent } from "./baseAgent.ts";
import { AgentState } from "../../types/index.ts";
import { llmService } from "../../services/llm.ts";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

// ==================== NoteAgent ====================

export class NoteAgent extends BaseAgent {
  constructor() {
    super({
      id: "note-agent",
      name: "NoteAgent",
      toolNames: ["read_file", "write_file", "edit_file"],
      systemPrompt: `你是笔记管理专家。职责：
- 创建新笔记（写入 Markdown 文件）
- 搜索已有笔记（读取文件内容并检索关键词）
- 编辑笔记（修改已有内容）

工作方式：
1. 分析用户需求
2. 选择合适的工具操作
3. 执行并返回结果

输出格式（JSON）：
{
  "action": "工具名或 'finish'",
  "actionParams": { ... },
  "response": "最终回复（仅 finish 时）"
}`,
    });
  }

  async execute(input: string): Promise<any> {
    this.setState(AgentState.RUNNING);
    try {
      const systemContent = this.systemPrompt.replace(
        "TODO: will be dynamically injected",
        this.getToolDescriptions()
      );

      const messages = [
        new SystemMessage(systemContent),
        new HumanMessage(input),
      ];

      const response = await llmService.chat(messages as any);
      this.setState(AgentState.COMPLETED);

      return {
        type: "worker_completed",
        agent: "NoteAgent",
        response: response,
      };
    } catch (error) {
      this.setState(AgentState.ERROR);
      return {
        type: "worker_error",
        agent: "NoteAgent",
        error: String(error),
      };
    }
  }
}

// ==================== TaskAgent ====================

export class TaskAgent extends BaseAgent {
  constructor() {
    super({
      id: "task-agent",
      name: "TaskAgent",
      toolNames: ["read_file", "write_file", "bash"],
      systemPrompt: `你是待办管理专家。职责：
- 从笔记或对话中提取待办事项
- 创建和管理待办清单
- 标记待办完成状态

工作方式：
1. 分析内容，识别待办事项
2. 整理为结构化的待办清单
3. 保存到文件或返回给用户

输出格式（JSON）：
{
  "action": "工具名或 'finish'",
  "actionParams": { ... },
  "response": "最终回复（仅 finish 时）"
}`,
    });
  }

  async execute(input: string): Promise<any> {
    this.setState(AgentState.RUNNING);
    try {
      const systemContent = this.systemPrompt.replace(
        "TODO: will be dynamically injected",
        this.getToolDescriptions()
      );

      const messages = [
        new SystemMessage(systemContent),
        new HumanMessage(input),
      ];

      const response = await llmService.chat(messages as any);
      this.setState(AgentState.COMPLETED);

      return {
        type: "worker_completed",
        agent: "TaskAgent",
        response: response,
      };
    } catch (error) {
      this.setState(AgentState.ERROR);
      return {
        type: "worker_error",
        agent: "TaskAgent",
        error: String(error),
      };
    }
  }
}

// ==================== SearchAgent ====================

export class SearchAgent extends BaseAgent {
  constructor() {
    super({
      id: "search-agent",
      name: "SearchAgent",
      toolNames: ["read_file", "bash"],
      systemPrompt: `你是知识搜索专家。职责：
- 搜索笔记和本地知识库
- 检索相关文档和信息
- 整合搜索结果为结构化答案

工作方式：
1. 理解搜索需求
2. 使用工具检索相关内容
3. 整合并返回搜索结果

输出格式（JSON）：
{
  "action": "工具名或 'finish'",
  "actionParams": { ... },
  "response": "最终回复（仅 finish 时）"
}`,
    });
  }

  async execute(input: string): Promise<any> {
    this.setState(AgentState.RUNNING);
    try {
      const systemContent = this.systemPrompt.replace(
        "TODO: will be dynamically injected",
        this.getToolDescriptions()
      );

      const messages = [
        new SystemMessage(systemContent),
        new HumanMessage(input),
      ];

      const response = await llmService.chat(messages as any);
      this.setState(AgentState.COMPLETED);

      return {
        type: "worker_completed",
        agent: "SearchAgent",
        response: response,
      };
    } catch (error) {
      this.setState(AgentState.ERROR);
      return {
        type: "worker_error",
        agent: "SearchAgent",
        error: String(error),
      };
    }
  }
}

// ==================== FileAgent ====================

export class FileAgent extends BaseAgent {
  constructor() {
    super({
      id: "file-agent",
      name: "FileAgent",
      toolNames: ["read_file", "write_file", "edit_file", "bash"],
      systemPrompt: `你是文件管理专家。职责：
- 读取文件内容
- 创建和写入文件
- 编辑已有文件
- 执行文件相关命令

工作方式：
1. 确认文件操作需求
2. 选择合适的文件工具
3. 执行并返回结果

输出格式（JSON）：
{
  "action": "工具名或 'finish'",
  "actionParams": { ... },
  "response": "最终回复（仅 finish 时）"
}`,
    });
  }

  async execute(input: string): Promise<any> {
    this.setState(AgentState.RUNNING);
    try {
      const systemContent = this.systemPrompt.replace(
        "TODO: will be dynamically injected",
        this.getToolDescriptions()
      );

      const messages = [
        new SystemMessage(systemContent),
        new HumanMessage(input),
      ];

      const response = await llmService.chat(messages as any);
      this.setState(AgentState.COMPLETED);

      return {
        type: "worker_completed",
        agent: "FileAgent",
        response: response,
      };
    } catch (error) {
      this.setState(AgentState.ERROR);
      return {
        type: "worker_error",
        agent: "FileAgent",
        error: String(error),
      };
    }
  }
}

// ==================== Worker Registry ====================

/**
 * Worker Agent 注册表 — 根据 assignedAgent 名称查找对应 Worker
 */
const workerRegistry: Map<string, BaseAgent> = new Map([
  ["NoteAgent", new NoteAgent()],
  ["TaskAgent", new TaskAgent()],
  ["SearchAgent", new SearchAgent()],
  ["FileAgent", new FileAgent()],
]);

/**
 * 根据 Agent 名称获取 Worker 实例
 */
export function getWorker(name: string): BaseAgent | undefined {
  return workerRegistry.get(name);
}

/**
 * 获取所有可用的 Worker Agent 名称
 */
export function getAvailableWorkers(): string[] {
  return Array.from(workerRegistry.keys());
}