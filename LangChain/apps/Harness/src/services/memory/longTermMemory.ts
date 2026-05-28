/**
 * LongTermMemory - 长期记忆（跨对话持久化）
 * 
 * 核心概念：
 *   长期记忆模拟人类"之前学过的知识"的能力。
 *   重要的对话内容、事实知识会被持久化存储，
 *   在未来任何对话中都能通过语义检索被召回。
 * 
 * 存储方式：
 *   通过 RAG Pipeline 存入 Chroma 向量数据库，
 *   支持语义检索（向量）+ 关键词检索 + 混合检索。
 * 
 * 记忆筛选策略（importance 过滤）：
 *   不是所有对话都值得长期记忆。
 *   只有 importance >= threshold 的消息才会被存入。
 *   importance 由以下因素决定：
 *   - 消息长度（长内容通常更重要）
 *   - 是否包含关键信息（事实、决策等）
 *   - 是否是 assistant 的回答（通常比闲聊更重要）
 */

import { Document } from "@langchain/core/documents";
import { BaseMemory,type MemoryMessage, type MemorySearchResult } from "./baseMemory.ts";
import { RAGPipeline } from "../rag/pipeline.ts";
import { config } from "../../config/index.ts";

export interface LongTermMemoryConfig {
  /** 重要性阈值：只有 importance >= threshold 的消息才会存入长期记忆 */
  importanceThreshold: number;
  /** 检索模式：vector、keyword、hybrid */
  retrievalMode: "vector" | "keyword" | "hybrid";
  /** 检索数量 */
  topK: number;
  /** 衰减因子：随时间降低旧记忆的重要性 */
  decayFactor: number;
}

const DEFAULT_LTM_CONFIG: LongTermMemoryConfig = {
  importanceThreshold: config.memory.longTermMemory.threshold * 0.5,
  retrievalMode: "hybrid",
  topK: config.memory.longTermMemory.topK,
  decayFactor: config.memory.longTermMemory.decayFactor,
};

export class LongTermMemory extends BaseMemory {
  private ragPipeline: RAGPipeline;
  private config: LongTermMemoryConfig;
  private localCache: MemoryMessage[] = []; // 本地缓存（用于 getAll）
  private initialized: boolean = false;

  constructor(configOverride?: Partial<LongTermMemoryConfig>) {
    super(10000); // 长期记忆容量大，由 Chroma 管理
    this.config = { ...DEFAULT_LTM_CONFIG, ...configOverride };
    this.ragPipeline = new RAGPipeline();
  }

  get type(): string {
    return "long_term";
  }

  /**
   * 初始化（连接 Chroma）
   * 
   * 必须在使用前调用。需要 Chroma 服务运行中。
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.ragPipeline.reset();
    await this.ragPipeline.initialize();
    this.initialized = true;
    console.log("[LongTermMemory] Initialized, connected to Chroma");
  }

  /**
   * 添加一条长期记忆
   * 
   * 流程：
   *   1. 评估消息的重要性（importance）
   *   2. 如果 importance >= threshold，存入 RAG
   *   3. 否则跳过（不值得长期记忆）
   * 
   * importance 评估规则：
   *   - 用户显式指定 → 直接使用
   *   - assistant 回答 → 基础分 0.6
   *   - 内容长度 > 200 字 → +0.2
   *   - 包含事实性关键词 → +0.1
   */
  async add(message: MemoryMessage): Promise<void> {
    const importance = this._evaluateImportance(message);
    message.importance = importance;

    if (importance < this.config.importanceThreshold) {
      console.log(`[LongTermMemory] Skipped (importance ${importance.toFixed(2)} < threshold ${this.config.importanceThreshold})`);
      return;
    }

    // 存入本地缓存
    this.localCache.push(message);

    // 存入 RAG 向量库
    const doc = new Document({
      pageContent: message.content,
      metadata: {
        source: `memory_${message.id}`,
        role: message.role,
        importance: importance,
        conversationId: message.conversationId || "unknown",
        timestamp: message.timestamp.toISOString(),
        memoryType: "long_term",
      },
    });

    await this.ragPipeline.indexDocuments([doc]);
    console.log(`[LongTermMemory] Stored (importance: ${importance.toFixed(2)})`);
  }

  /**
   * 评估消息重要性
   */
  private _evaluateImportance(message: MemoryMessage): number {
    // 如果已有 importance，直接使用
    if (message.importance !== undefined) {
      return message.importance;
    }

    let score = 0.3; // 基础分

    // assistant 回答更重要
    if (message.role === "assistant") {
      score += 0.3;
    }

    // 长内容通常更重要
    if (message.content.length > 200) {
      score += 0.2;
    }

    // 包含事实性关键词
    const factualKeywords = ["定义", "原因", "方法", "步骤", "结论", "注意", "重要", "关键"];
    if (factualKeywords.some(kw => message.content.includes(kw))) {
      score += 0.1;
    }

    // 用户提问也值得记住
    if (message.role === "user" && message.content.includes("?") || message.content.includes("？")) {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  }

  /**
   * 从长期记忆中检索
   * 
   * 使用 RAG 的语义检索能力：
   *   - vector: 语义相似匹配
   *   - keyword: 关键词精确匹配
   *   - hybrid: 混合检索（默认）
   * 
   * 衰减机制：旧记忆的 score 会被 decayFactor 降低
   */
  async search(query: string, topK?: number): Promise<MemorySearchResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const k = topK || this.config.topK;
    const ragResults = await this.ragPipeline.retrieve(query, this.config.retrievalMode, k);

    return ragResults.map(r => {
      // 应用时间衰减
      const timestamp = r.document.metadata?.timestamp as string;
      let decayedScore = r.finalScore;

      if (timestamp) {
        const ageMs = Date.now() - new Date(timestamp).getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        decayedScore *= Math.pow(this.config.decayFactor, ageDays);
      }

      return {
        message: {
          id: r.document.metadata?.source as string || "unknown",
          role: (r.document.metadata?.role as string || "assistant") as any,
          content: r.document.pageContent,
          timestamp: new Date(timestamp || Date.now()),
          importance: r.document.metadata?.importance as number,
          conversationId: r.document.metadata?.conversationId as string,
          memoryType: "long_term",
        },
        score: decayedScore,
        source: "long_term",
      };
    });
  }

  getAll(): MemoryMessage[] {
    return [...this.localCache];
  }

  clear(): void {
    this.localCache = [];
    // 注意：这只清本地缓存，Chroma 中的数据需要 ragPipeline.reset()
  }

  count(): number {
    return this.localCache.length;
  }

  /** 获取 RAG Pipeline（用于高级操作） */
  getPipeline(): RAGPipeline {
    return this.ragPipeline;
  }

  /** 获取当前配置 */
  getConfig(): LongTermMemoryConfig {
    return { ...this.config };
  }
}