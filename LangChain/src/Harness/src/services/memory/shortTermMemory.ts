/**
 * ShortTermMemory - 短期记忆（对话历史）
 * 
 * 核心概念：
 *   短期记忆模拟人类"刚才说了什么"的能力。
 *   对话历史会随着轮次增长，但 LLM 的 context window 有限，
 *   所以需要用滑动窗口控制保留的消息数量。
 * 
 * 滑动窗口策略：
 *   - 保留最近 N 条消息（windowSize）
 *   - 超出窗口的旧消息自动丢弃
 *   - 系统消息（role=system）永远保留
 *   - 丢弃时保留摘要（可选）
 * 
 * 搜索策略：
 *   - 简单关键词匹配（短期记忆量小，不需要向量检索）
 *   - 按时间排序（最近的消息优先）
 */

import { BaseMemory,type MemoryMessage,type MemorySearchResult } from "./baseMemory.ts";
import { config } from "../../config/index.ts";

export interface ShortTermMemoryConfig {
  /** 滑动窗口大小：保留最近多少条消息 */
  windowSize: number;
  /** 是否对超出窗口的消息生成摘要 */
  enableSummary: boolean;
}

const DEFAULT_STM_CONFIG: ShortTermMemoryConfig = {
  windowSize: config.memory.workingMemory.maxTurns,
  enableSummary: false,
};

export class ShortTermMemory extends BaseMemory {
  private messages: MemoryMessage[] = [];
  private config: ShortTermMemoryConfig;
  private summaryCache: string = ""; // 超出窗口内容的摘要

  constructor(configOverride?: Partial<ShortTermMemoryConfig>) {
    super(configOverride?.windowSize || DEFAULT_STM_CONFIG.windowSize);
    this.config = { ...DEFAULT_STM_CONFIG, ...configOverride };
  }

  get type(): string {
    return "short_term";
  }

  /**
   * 添加一条对话消息
   * 
   * 超出窗口时：
   *   - system 消息永远保留
   *   - 最旧的非 system 消息被移除
   *   - 如果 enableSummary=true，移除的消息会累积摘要
   */
  async add(message: MemoryMessage): Promise<void> {
    this.messages.push(message);
    this.messages = this._applySlidingWindow();
  }

  /**
   * 滑动窗口机制
   * 
   *   保留策略：
   *   1. system 消息永远保留（它们是 prompt 基础）
   *   2. 非 system 消息只保留最近 windowSize 条
   *   3. 超出的旧消息丢弃（或摘要）
   */
  private _applySlidingWindow(): MemoryMessage[] {
    const systemMessages = this.messages.filter(m => m.role === "system");
    const nonSystemMessages = this.messages.filter(m => m.role !== "system");

    // 如果超出窗口
    if (nonSystemMessages.length > this.config.windowSize) {
      const overflow = nonSystemMessages.slice(0, nonSystemMessages.length - this.config.windowSize);

      if (this.config.enableSummary) {
        // 累积摘要
        const overflowSummary = overflow
          .map(m => `[${m.role}] ${m.content.slice(0, 100)}`)
          .join("\n");
        this.summaryCache += (this.summaryCache ? "\n" : "") + overflowSummary;
      }

      // 只保留最近 windowSize 条非 system 消息
      const kept = nonSystemMessages.slice(-this.config.windowSize);
      return [...systemMessages, ...kept];
    }

    return [...systemMessages, ...nonSystemMessages];
  }

  /**
   * 搜索短期记忆（关键词匹配）
   * 
   * 短期记忆量小，用简单的关键词匹配即可：
   *   - 匹配度 = 命中关键词数 / query 关键词数
   *   - 最近的消息 score 更高（时间衰减）
   */
  async search(query: string, topK?: number): Promise<MemorySearchResult[]> {
    const k = topK || 5;
    const queryKeywords = query.toLowerCase().split(/\s+/);

    const scored = this.messages
      .filter(m => m.role !== "system") // 不搜索 system 消息
      .map((msg, idx) => {
        const contentLower = msg.content.toLowerCase();
        const hits = queryKeywords.filter(kw => contentLower.includes(kw)).length;
        const keywordScore = hits / queryKeywords.length;

        // 时间衰减：越近的消息权重越高
        const position = idx / this.messages.length;
        const timeScore = 0.5 + 0.5 * position;

        return {
          message: { ...msg, memoryType: "short_term" as const },
          score: keywordScore * 0.7 + timeScore * 0.3,
          source: "short_term" as const,
        };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    return scored;
  }

  getAll(): MemoryMessage[] {
    return [...this.messages];
  }

  /**
   * 获取对话历史（格式化为 LLM messages 数组）
   */
  getHistory(): MemoryMessage[] {
    if (this.summaryCache) {
      // 在对话历史开头插入摘要
      const summaryMsg: MemoryMessage = {
        id: "summary",
        role: "system",
        content: `[之前的对话摘要]\n${this.summaryCache}`,
        timestamp: new Date(),
        memoryType: "short_term",
      };
      const systemMsgs = this.messages.filter(m => m.role === "system");
      const nonSystemMsgs = this.messages.filter(m => m.role !== "system");
      return [...systemMsgs, summaryMsg, ...nonSystemMsgs];
    }
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
    this.summaryCache = "";
  }

  count(): number {
    return this.messages.length;
  }

  /** 获取摘要缓存 */
  getSummary(): string {
    return this.summaryCache;
  }
}