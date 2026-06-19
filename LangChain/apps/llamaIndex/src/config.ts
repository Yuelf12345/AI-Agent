/**
 * 全局 Settings 配置模块
 * 
 * 统一管理 LlamaIndex 的全局设置，确保跨平台一致性
 * 
 * 关键设计：
 * 1. 同时从 llamaindex 和 @llamaindex/core/global 导入 Settings
 * 2. 显式设置两个实例，避免 pnpm 依赖提升导致的模块隔离问题
 * 3. 提供 initGlobalSettings() 函数供各模块显式调用
 */

import { Settings } from "llamaindex";
// Workaround: 同时导入 @llamaindex/core/global 的 Settings，确保 llamaIndex 内部也能访问
import { Settings as CoreSettings } from "@llamaindex/core/global";
import embeddingModel from "./embedding.ts";
import llm from "./llm.ts";

let isConfigured = false;

/**
 * 初始化全局 Settings
 * 必须在调用任何需要 LLM/Embedding 的功能前调用此函数
 */
export function initGlobalSettings(): void {
  if (isConfigured) {
    console.log('⚠️  全局 Settings 已配置，跳过重复初始化');
    return;
  }

  // 同时设置两个 Settings 实例，确保跨平台兼容性
  Settings.llm = llm;
  Settings.embedModel = embeddingModel;

  CoreSettings.llm = llm;
  CoreSettings.embedModel = embeddingModel;

  isConfigured = true;

  console.log(`✅ 全局 Settings 配置完成`);
  console.log(`   - LLM: ${process.env.LOCAL === "true" ? "本地 (Ollama qwen2.5:7b)" : "云端 (阿里云 qwen-plus)"}`);
  console.log(`   - Embedding: ${embeddingModel.model} (${process.env.LOCAL === "true" ? "本地 Ollama" : "云端阿里云"})`);
}
