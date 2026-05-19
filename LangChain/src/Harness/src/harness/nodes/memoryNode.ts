/**
 * memoryNode - Memory 注入节点
 *
 * 在 router 之后、Agent 之前执行。
 * 从 CompositeMemory 获取上下文，注入到状态中，
 * 供后续 Agent 节点使用。
 *
 * 功能：
 *   1. 从三层记忆检索与当前问题相关的信息
 *   2. 构造完整的记忆上下文 prompt
 *   3. 注入到 state.memoryContext 和 state.relevantKnowledge
 */

import { CompositeMemory } from "../../services/memory/index.ts";
import type { MemorySearchResult } from "../../services/memory/index.ts";

/**
 * 全局 Memory 实例
 *
 * 可通过 setMemoryInstance() 替换为自定义实例
 */
let memoryInstance: CompositeMemory | null = null;

/**
 * 设置 Memory 实例（用于依赖注入）
 */
export function setMemoryInstance(memory: CompositeMemory): void {
  memoryInstance = memory;
}

/**
 * 获取 Memory 实例
 */
export function getMemoryInstance(): CompositeMemory {
  if (!memoryInstance) {
    memoryInstance = new CompositeMemory();
  }
  return memoryInstance;
}

/**
 * Memory 注入节点
 *
 * 输入：state.messages 中的用户消息
 * 输出：state.memoryContext（完整记忆上下文 prompt）
 *       state.relevantKnowledge（检索到的相关知识列表）
 */
export async function memoryNode(state: any): Promise<Partial<any>> {
  const query = state.messages?.[state.messages.length - 1]?.content || "";

  if (!query) {
    return {
      memoryContext: null,
      relevantKnowledge: [],
      currentStep: "memory",
    };
  }

  const memory = getMemoryInstance();

  // 1. 从三层记忆检索相关信息
  let searchResults: MemorySearchResult[] = [];
  try {
    searchResults = await memory.search(query, 5);
  } catch (error: any) {
    console.log(`[MemoryNode] search failed: ${error.message}`);
    searchResults = [];
  }

  // 2. 构造记忆上下文
  let memoryContext: string | null = null;

  // 获取完整的上下文（包含对话历史、工作状态等）
  try {
    const context = await memory.getContext(query);
    const promptText = context.toPrompt();
    if (promptText.trim()) {
      memoryContext = promptText;
    }
  } catch (error: any) {
    console.log(`[MemoryNode] getContext failed: ${error.message}`);
  }

  // 3. 将用户消息存入 Memory
  try {
    await memory.add({
      id: `msg-user-${Date.now()}`,
      role: "user",
      content: query,
      importance: 0.5,
      timestamp: new Date(),
    });
  } catch (error: any) {
    console.log(`[MemoryNode] add user message failed: ${error.message}`);
  }

  // 4. 组织检索到的知识
  const relevantKnowledge = searchResults.map((r) => ({
    content: r.message.content.slice(0, 500),
    source: r.source,
    score: r.score,
    role: r.message.role,
  }));

  console.log(`[MemoryNode] query="${query.slice(0, 50)}", knowledge=${relevantKnowledge.length}, context=${memoryContext ? memoryContext.length : 0} chars`);

  return {
    memoryContext,
    relevantKnowledge,
    currentStep: "memory",
  };
}