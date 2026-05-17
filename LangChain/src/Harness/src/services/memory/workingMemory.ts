/**
 * WorkingMemory - 工作记忆（Agent 推理中间状态）
 * 
 * 核心概念：
 *   工作记忆模拟人类"正在思考什么"的能力。
 *   在 Agent 推理过程中，需要临时存储：
 *   - 当前任务是什么
 *   - 推理到了哪一步（thought chain）
 *   - 工具调用的结果
 *   - 中间计算结果
 * 
 * 特点：
 *   - 生命周期短：只在一次推理过程中有效
 *   - 不需要持久化：推理结束后清空
 *   - 不需要向量检索：直接按 key 取值
 *   - 类似 LLM 的 "scratchpad"（草稿纸）
 * 
 * 结构：
 *   {
 *     currentTask: "帮我分析这份报告",   ← 当前任务
 *     reasoningSteps: ["先读取文件", ...], ← 推理步骤
 *     toolResults: { readFile: "..." },   ← 工具结果缓存
 *     variables: { reportTitle: "..." },  ← 中间变量
 *   }
 */

import { BaseMemory,type MemoryMessage,type MemorySearchResult } from "./baseMemory.ts";

export interface WorkingMemoryState {
  /** 当前任务描述 */
  currentTask: string | null;
  /** 推理步骤记录（thought chain） */
  reasoningSteps: string[];
  /** 工具调用结果缓存 */
  toolResults: Record<string, unknown>;
  /** 自定义变量存储 */
  variables: Record<string, unknown>;
}

export class WorkingMemory extends BaseMemory {
  private state: WorkingMemoryState;
  private history: MemoryMessage[] = []; // 推理过程的消息记录

  constructor() {
    super(50); // 工作记忆容量小
    this.state = {
      currentTask: null,
      reasoningSteps: [],
      toolResults: {},
      variables: {},
    };
  }

  get type(): string {
    return "working";
  }

  /**
   * 添加一条工作记忆
   * 
   * 根据消息类型自动分类：
   *   - role=tool → 存入 toolResults
   *   - role=assistant → 存入 reasoningSteps
   *   - role=user → 更新 currentTask
   */
  async add(message: MemoryMessage): Promise<void> {
    this.history.push(message);

    switch (message.role) {
      case "user":
        // 用户消息更新当前任务
        this.state.currentTask = message.content;
        break;
      case "assistant":
        // assistant 消息作为推理步骤
        this.state.reasoningSteps.push(message.content);
        break;
      case "tool":
        // tool 消息存入工具结果缓存
        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const tc of message.tool_calls) {
            this.state.toolResults[tc.tool] = message.tool_result;
          }
        }
        break;
    }
  }

  /**
   * 搜索工作记忆
   * 
   * 工作记忆量小，用关键词匹配即可：
   *   - 在 reasoningSteps、toolResults、variables 中搜索
   */
  async search(query: string, topK?: number): Promise<MemorySearchResult[]> {
    const k = topK || 5;
    const queryLower = query.toLowerCase();
    const results: MemorySearchResult[] = [];

    // 在推理步骤中搜索
    for (const step of this.state.reasoningSteps) {
      if (step.toLowerCase().includes(queryLower)) {
        results.push({
          message: {
            id: `working_step_${results.length}`,
            role: "assistant",
            content: step,
            timestamp: new Date(),
            memoryType: "working",
          },
          score: 0.8, // 工作记忆搜索命中率高
          source: "working",
        });
      }
    }

    // 在工具结果中搜索
    for (const [toolName, result] of Object.entries(this.state.toolResults)) {
      const resultStr = JSON.stringify(result);
      if (resultStr.toLowerCase().includes(queryLower) || toolName.toLowerCase().includes(queryLower)) {
        results.push({
          message: {
            id: `working_tool_${toolName}`,
            role: "tool",
            content: resultStr.slice(0, 500),
            timestamp: new Date(),
            memoryType: "working",
          },
          score: 0.9,
          source: "working",
        });
      }
    }

    return results.slice(0, k);
  }

  getAll(): MemoryMessage[] {
    return [...this.history];
  }

  /** 获取当前工作状态 */
  getState(): WorkingMemoryState {
    return { ...this.state };
  }

  /** 设置当前任务 */
  setCurrentTask(task: string): void {
    this.state.currentTask = task;
  }

  /** 添加推理步骤 */
  addReasoningStep(step: string): void {
    this.state.reasoningSteps.push(step);
  }

  /** 缓存工具结果 */
  setToolResult(toolName: string, result: unknown): void {
    this.state.toolResults[toolName] = result;
  }

  /** 设置自定义变量 */
  setVariable(key: string, value: unknown): void {
    this.state.variables[key] = value;
  }

  /** 获取自定义变量 */
  getVariable(key: string): unknown {
    return this.state.variables[key];
  }

  /** 获取推理步骤数量 */
  getStepCount(): number {
    return this.state.reasoningSteps.length;
  }

  clear(): void {
    this.state = {
      currentTask: null,
      reasoningSteps: [],
      toolResults: {},
      variables: {},
    };
    this.history = [];
  }

  count(): number {
    return this.history.length;
  }
}