/**
 * CompositeMemory - 组合记忆（三层 Memory 的统一入口）
 * 
 * 这是 Agent 实际使用的记忆接口。
 * 它组合了三层记忆，对外提供统一 API：
 * 
 *   add(message)     → 自动判断存哪层：
 *     - 日常对话 → ShortTerm
 *     - 重要知识 → ShortTerm + LongTerm
 *     - 推理过程 → Working
 * 
 *   search(query)    → 从三层中检索，合并排序：
 *     - ShortTerm: 最近对话中的关键词
 *     - LongTerm:  RAG 语义检索
 *     - Working:   当前推理步骤
 * 
 *   getContext()     → 为 LLM 构造完整 prompt context：
 *     - 对话历史（ShortTerm）
 *     - 相关知识（LongTerm 检索结果）
 *     - 工作状态（Working）
 */

import { ShortTermMemory } from "./shortTermMemory.ts";
import { LongTermMemory } from "./longTermMemory.ts";
import { WorkingMemory } from "./workingMemory.ts";
import type {
  BaseMemory,
  MemoryMessage,
  MemorySearchResult,
  MemoryContext,
} from "./baseMemory.ts";

export class CompositeMemory {
  private shortTerm: ShortTermMemory;
  private longTerm: LongTermMemory;
  private working: WorkingMemory;

  constructor(
    stmConfig?: Partial<{ windowSize: number; enableSummary: boolean }>,
    ltmConfig?: Partial<{
      importanceThreshold: number;
      retrievalMode: "vector" | "keyword" | "hybrid";
      topK: number;
      decayFactor: number;
    }>,
  ) {
    this.shortTerm = new ShortTermMemory(stmConfig);
    this.longTerm = new LongTermMemory(ltmConfig);
    this.working = new WorkingMemory();
  }

  // ==================== 统一接口 ====================

  /**
   * 添加一条记忆
   * 
   * 自动路由策略：
   *   1. 所有消息 → ShortTerm（对话历史）
   *   2. importance >= threshold 的 → 同时存入 LongTerm
   *   3. 推理过程中的 → 同时存入 Working
   * 
   * 消息分类规则：
   *   - role=user / role=assistant → ShortTerm + (maybe LongTerm)
   *   - role=tool → ShortTerm + Working
   *   - role=system → ShortTerm only（系统提示不需要长期记忆）
   */
  async add(message: MemoryMessage): Promise<void> {
    // 1. 所有消息存入短期记忆
    await this.shortTerm.add(message);

    // 2. 重要消息同时存入长期记忆
    //    - system 消息不存入长期记忆
    //    - 需要用户显式标记 importance 或由系统评估
    if (message.role !== "system") {
      // 评估重要性（如果未指定）
      const importance = message.importance ?? this._autoEvaluateImportance(message);
      const enrichedMessage = { ...message, importance };

      if (importance >= this.longTerm.getConfig().importanceThreshold) {
        // 需要 Chroma 服务
        try {
          await this.longTerm.add(enrichedMessage);
        } catch (error: any) {
          console.log(`[CompositeMemory] LongTerm storage skipped: ${error.message}`);
        }
      }
    }

    // 3. 工具调用和推理步骤存入工作记忆
    if (message.role === "tool" || message.memoryType === "working") {
      await this.working.add(message);
    }
  }

  /**
   * 自动评估消息重要性
   */
  private _autoEvaluateImportance(message: MemoryMessage): number {
    let score = 0.3;

    if (message.role === "assistant") score += 0.3;
    if (message.content.length > 200) score += 0.2;
    if (message.content.includes("？") || message.content.includes("?")) score += 0.1;
    if (message.content.includes("定义") || message.content.includes("关键") || message.content.includes("重要")) score += 0.1;

    return Math.min(score, 1.0);
  }

  /**
   * 统一搜索：从三层记忆中检索
   * 
   * 搜索顺序：
   *   1. Working → 最近的推理步骤（score × 1.0，最相关）
   *   2. ShortTerm → 最近对话（score × 0.8）
   *   3. LongTerm → RAG 检索（score × 0.6，需要 Chroma）
 * 
   * 合并后按 score 排序，去重，返回 topK
   */
  async search(query: string, topK?: number): Promise<MemorySearchResult[]> {
    const k = topK || 5;
    const allResults: MemorySearchResult[] = [];

    // 1. Working Memory
    const workingResults = await this.working.search(query, k);
    allResults.push(...workingResults.map(r => ({
      ...r,
      score: r.score * 1.0, // 工作记忆最相关
    })));

    // 2. Short-Term Memory
    const stmResults = await this.shortTerm.search(query, k);
    allResults.push(...stmResults.map(r => ({
      ...r,
      score: r.score * 0.8, // 近期对话次相关
    })));

    // 3. Long-Term Memory（需要 Chroma）
    try {
      const ltmResults = await this.longTerm.search(query, k);
      allResults.push(...ltmResults.map(r => ({
        ...r,
        score: r.score * 0.6, // 长期记忆需要衰减
      })));
    } catch (error: any) {
      console.log(`[CompositeMemory] LongTerm search skipped: ${error.message}`);
    }

    // 按内容去重（保留 score 更高的）
    const deduplicated = this._deduplicate(allResults);

    // 按分数排序
    return deduplicated
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /** 去重：同一内容可能被多层记忆检索到 */
  private _deduplicate(results: MemorySearchResult[]): MemorySearchResult[] {
    const seen = new Map<string, MemorySearchResult>();

    for (const r of results) {
      const key = r.message.content.slice(0, 100); // 用前100字符作为去重键
      const existing = seen.get(key);
      if (!existing || r.score > existing.score) {
        seen.set(key, r);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * 为 LLM 构造完整的 Prompt 上下文
   * 
   * 这是 Memory 系统最核心的功能：
   *   将三层记忆的信息整合成 LLM 可以理解的 prompt。
   * 
   * 输出格式：
   *   [系统提示]
   *   [当前任务] ...
   *   [相关知识] ...
   *   [对话历史] ...
   *   [推理步骤] ...
   */
  async getContext(query?: string): Promise<MemoryContext> {
    const conversationHistory = this.shortTerm.getHistory();
    const workingState = this.working.getState();

    // 如果有 query，从长期记忆检索相关知识
    let relevantKnowledge: MemorySearchResult[] = [];
    if (query) {
      try {
        relevantKnowledge = await this.longTerm.search(query, 3);
      } catch {
        relevantKnowledge = [];
      }
    }

    const context: MemoryContext = {
      conversationHistory,
      relevantKnowledge,
      workingState,
      toPrompt() {
        const parts: string[] = [];

        // 当前任务
        if (workingState.currentTask) {
          parts.push(`【当前任务】${workingState.currentTask}`);
        }

        // 相关知识
        if (relevantKnowledge.length > 0) {
          parts.push("【相关知识】");
          relevantKnowledge.forEach((r, i) => {
            parts.push(`  [${i + 1}] (来源: ${r.source}, 相关度: ${r.score.toFixed(2)}) ${r.message.content.slice(0, 200)}`);
          });
        }

        // 推理步骤
        if (workingState.reasoningSteps.length > 0) {
          parts.push("【推理步骤】");
          workingState.reasoningSteps.forEach((step, i) => {
            parts.push(`  Step ${i + 1}: ${step.slice(0, 100)}`);
          });
        }

        // 工具结果摘要
        const toolNames = Object.keys(workingState.toolResults);
        if (toolNames.length > 0) {
          parts.push(`【已调用工具】${toolNames.join(", ")}`);
        }

        return parts.join("\n");
      },
    };

    return context;
  }

  // ==================== 子组件访问 ====================

  getShortTerm(): ShortTermMemory {
    return this.shortTerm;
  }

  getLongTerm(): LongTermMemory {
    return this.longTerm;
  }

  getWorking(): WorkingMemory {
    return this.working;
  }

  /** 初始化长期记忆（连接 Chroma） */
  async initializeLongTerm(): Promise<void> {
    await this.longTerm.initialize();
  }

  /** 清空所有记忆 */
  clearAll(): void {
    this.shortTerm.clear();
    this.working.clear();
    // 长期记忆需要单独清理（涉及 Chroma）
  }

  /** 清空工作记忆（推理结束后） */
  clearWorking(): void {
    this.working.clear();
  }
}