/**
 * Memory 系统 - Agent 的记忆基础设施
 * 
 * 三层记忆架构：
 *   ┌───────────────────────────────────────────┐
 *   │  ShortTermMemory（短期记忆）              │  ← 对话历史，滑动窗口
 *   │  - 当前对话的 messages                    │  ← windowSize 控制
 *   │  - 自动丢弃旧消息                        │  ← 滑动窗口机制
 *   ├───────────────────────────────────────────┤
 *   │  LongTermMemory（长期记忆）               │  ← 持久化，跨对话检索
 *   │  - 通过 RAG 向量检索                      │  ← 存入 Chroma
 *   │  - 重要对话/知识自动存入                  │  ← importance 过滤
 *   ├───────────────────────────────────────────┤
 *   │  WorkingMemory（工作记忆）                │  ← Agent 推理中间状态
 *   │  - 当前任务、推理步骤                    │  ← scratchpad
 *   │  - 工具调用结果                          │  ← 临时缓存
 *   └───────────────────────────────────────────┘
 * 
 * CompositeMemory 将三层组合，对外统一接口：
 *   add() → 自动判断存哪层
 *   search() → 从三层中检索
 *   getContext() → 为 LLM 构造完整的 prompt context
 */
import type { Message, MessageRole } from "../../types/index.ts";

// ==================== Memory Message 类型 ====================

/**
 * 记忆消息 - 扩展 Message，增加记忆相关元数据
 */
export interface MemoryMessage extends Message {
  /** 消息重要性评分 0-1，越高越可能存入长期记忆 */
  importance?: number;
  /** 记忆来源：哪个对话 */
  conversationId?: string;
  /** 记忆类型标记 */
  memoryType?: "short_term" | "long_term" | "working";
}

/**
 * 记忆检索结果
 */
export interface MemorySearchResult {
  message: MemoryMessage;
  score: number;
  source: "short_term" | "long_term" | "working";
}

/**
 * 为 LLM 构造的上下文
 */
export interface MemoryContext {
  /** 当前对话历史（滑动窗口） */
  conversationHistory: MemoryMessage[];
  /** 从长期记忆检索到的相关知识 */
  relevantKnowledge: MemorySearchResult[];
  /** 当前工作状态 */
  workingState: {
    currentTask: string | null;
    reasoningSteps: string[];
    toolResults: Record<string, unknown>;
  };
  /** 格式化为 LLM prompt 的文本 */
  toPrompt(): string;
}

// ==================== BaseMemory 抽象类 ====================

/**
 * Memory 抽象基类
 * 
 * 所有 Memory 类型都实现相同的核心接口：
 *   - add: 添加记忆
 *   - search: 搜索记忆
 *   - clear: 清空记忆
 *   - getContext: 获取上下文
 */
export abstract class BaseMemory {
  protected maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  /** 添加一条记忆 */
  abstract add(message: MemoryMessage): Promise<void>;

  /** 批量添加记忆 */
  async addMany(messages: MemoryMessage[]): Promise<void> {
    for (const msg of messages) {
      await this.add(msg);
    }
  }

  /** 搜索相关记忆 */
  abstract search(query: string, topK?: number): Promise<MemorySearchResult[]>;

  /** 获取所有记忆 */
  abstract getAll(): MemoryMessage[];

  /** 清空记忆 */
  abstract clear(): void;

  /** 获取记忆数量 */
  abstract count(): number;

  /** 记忆类型名称 */
  abstract get type(): string;
}