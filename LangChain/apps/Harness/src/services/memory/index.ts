/**
 * Memory 系统入口
 *
 * 使用方式：
 *   import { CompositeMemory } from "../services/memory/index.ts";
 *
 *   const memory = new CompositeMemory();
 *   await memory.add({ role: "user", content: "什么是 RAG", ... });
 *   const context = await memory.getContext("什么是 RAG");
 */
export { BaseMemory,type MemoryMessage,type MemorySearchResult,type MemoryContext } from "./baseMemory.ts";
export { ShortTermMemory, type ShortTermMemoryConfig } from "./shortTermMemory.ts";
export { LongTermMemory, type LongTermMemoryConfig } from "./longTermMemory.ts";
export { WorkingMemory,type WorkingMemoryState } from "./workingMemory.ts";
export { CompositeMemory } from "./compositeMemory.ts";