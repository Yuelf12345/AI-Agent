/**
 * 全局 Settings 配置模块
 * 
 * 统一管理 LlamaIndex 的全局设置，确保跨平台一致性
 * 
 * 关键设计：
 * 1. 同时从 llamaindex 和 @llamaindex/core/global 导入 Settings
 * 2. 显式设置两个实例，避免 pnpm 依赖提升导致的模块隔离问题
 * 3. 在调用任何需要配置的函数前完成设置
 */

import { Settings } from "llamaindex";
// Workaround: 同时导入 @llamaindex/core/global 的 Settings，确保 llamaIndex 内部也能访问
import { Settings as CoreSettings } from "@llamaindex/core/global"import embeddingModel from "./embedding.ts";
import llm from "./llm.ts";

// ═══════════════════════════════════════════════════════════════════════
//  自动执行全局配置 — 模块加载时立即生效
// ═══════════════════════════════════════════════════════════════════════
Settings.llm = llm;
Settings.embedModel = embeddingModel;

CoreSettings.llm = llm;
CoreSettings.embedModel = embeddingModel;

console.log(`✅ 全局 Settings 配置完成`);
console.log(`   - LLM: ${process.env.LOCAL === "true" ? "本地 (Ollama qwen2.5:7b)" : "云端 (阿里云 qwen-plus)"}`);
console.log(`   - Embedding: ${embeddingModel.model} (${process.env.LOCAL === "true" ? "本地 Ollama" : "云端阿里云"})`);

/**
 * 配置全局 Settings
 * @param llm - LLM 实例
 * @param embedModel - Embedding 模型实例
 */
export function configureGlobalSettings(
  llm: OpenAILike,
  embedModel: OpenAIEmbedding
): void {
  // 同时设置两个 Settings 实例，确保跨平台兼容性
  Settings.llm = llm;
  Settings.embedModel = embedModel;
  
  CoreSettings.llm = llm;
  CoreSettings.embedModel = embedModel;
  
  console.log(`✅ 全局 Settings 配置完成`);
  console.log(`   - LLM: ${process.env.LOCAL === "true" ? "本地 (Ollama qwen2.5:7b)" : "云端 (阿里云 qwen-plus)"}`);
  console.log(`   - Embedding: ${embedModel.model} (${process.env.LOCAL === "true" ? "本地 Ollama" : "云端阿里云"})`);
}
