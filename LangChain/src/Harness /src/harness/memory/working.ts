import { v4 as uuidv4 } from 'uuid';
import type { WorkingMemory, Message, Task, ToolResult } from '../../types/index.js';
import { config } from '../../config/index.js';

/**
 * 工作记忆管理器
 * 管理当前对话的上下文
 */
export class WorkingMemoryManager {
  private memories: Map<string, WorkingMemory> = new Map();
  private maxTurns: number;

  constructor(maxTurns?: number) {
    this.maxTurns = maxTurns || config.memory.workingMemory.maxTurns;
  }

  /**
   * 创建新的工作记忆
   */
  create(conversationId: string): WorkingMemory {
    const memory: WorkingMemory = {
      conversationId,
      messages: [],
      currentTask: null,
      toolResults: [],
      metadata: {
        startTime: new Date(),
        turnCount: 0,
      },
    };

    this.memories.set(conversationId, memory);
    return memory;
  }

  /**
   * 获取工作记忆
   */
  get(conversationId: string): WorkingMemory | undefined {
    return this.memories.get(conversationId);
  }

  /**
   * 添加消息到工作记忆
   */
  addMessage(conversationId: string, role: 'user' | 'assistant' | 'tool', content: string): Message {
    let memory = this.memories.get(conversationId);
    
    if (!memory) {
      memory = this.create(conversationId);
    }

    const message: Message = {
      id: uuidv4(),
      role,
      content,
      timestamp: new Date(),
    };

    memory.messages.push(message);
    memory.metadata.turnCount++;

    // 检查是否超出最大轮次，如果超出则移除旧消息
    this.enforceMaxTurns(memory);

    return message;
  }

  /**
   * 设置当前任务
   */
  setCurrentTask(conversationId: string, task: Task | null): void {
    const memory = this.memories.get(conversationId);
    if (memory) {
      memory.currentTask = task;
    }
  }

  /**
   * 添加 Tool 结果
   */
  addToolResult(conversationId: string, result: ToolResult): void {
    const memory = this.memories.get(conversationId);
    if (memory) {
      memory.toolResults.push(result);
    }
  }

  /**
   * 清除 Tool 结果缓存
   */
  clearToolResults(conversationId: string): void {
    const memory = this.memories.get(conversationId);
    if (memory) {
      memory.toolResults = [];
    }
  }

  /**
   * 获取对话历史（用于 LLM 上下文）
   */
  getHistory(conversationId: string): Message[] {
    const memory = this.memories.get(conversationId);
    return memory?.messages || [];
  }

  /**
   * 获取最近的上下文摘要
   */
  getRecentContext(conversationId: string, turns: number = 3): string {
    const memory = this.memories.get(conversationId);
    if (!memory) return '';

    const recentMessages = memory.messages.slice(-turns * 2);
    return recentMessages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');
  }

  /**
   * 强制最大轮次限制
   */
  private enforceMaxTurns(memory: WorkingMemory): void {
    if (memory.messages.length > this.maxTurns * 2) {
      // 保留最近的消息
      const removeCount = memory.messages.length - this.maxTurns * 2;
      memory.messages = memory.messages.slice(removeCount);
    }
  }

  /**
   * 清除工作记忆
   */
  clear(conversationId: string): void {
    this.memories.delete(conversationId);
  }

  /**
   * 清除所有
   */
  clearAll(): void {
    this.memories.clear();
  }
}

export default WorkingMemoryManager;
