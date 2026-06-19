/**
 * Adaptive RAG（自适应 RAG）
 *
 * 根据问题复杂度自动选择不同的检索策略：
 *
 * ```
 * 用户查询 → Query Analyzer（问题分类器）
 *               ├─ simple → 直接回答（无需检索）
 *               ├─ medium → 单步 RAG（检索 → 生成）
 *               └─ complex → 多步迭代检索
 *                             检索 → 阅读 → 精炼查询 → 再检索 → 生成
 *                                            ↓
 *                                       LLM 生成回答
 * ```
 *
 * 与 Agentic RAG 的区别：
 * - Adaptive RAG 是预定义路由规则（if-else）
 * - Agentic RAG 是 Agent 自主动态决策（ReAct 循环）
 */

import path from "path";
import fs from "fs";
import * as readline from "readline";

// ─── LlamaIndex 核心模块 ────────────────────────────────────────────
import { SimpleDirectoryReader } from "@llamaindex/readers/directory";
import { Document, TextNode } from "@llamaindex/core/schema";
import {
  VectorStoreIndex,
  storageContextFromDefaults,
} from "llamaindex";

// ─── 本地模块 ────────────────────────────────────────────────────────
import embeddingModel from "../embedding.ts";
import llm, { tokenTracker } from "../llm.ts";
import { configureGlobalSettings } from "../config.ts";
import { LLMChunk } from "../check/index.ts";
import { FILE_DIR, STORAGE_DIR, CACHE_NAIVE } from "../constants.ts";

// ═══════════════════════════════════════════════════════════════════════
//  Step 0: 全局配置 — 使用统一的配置函数
// ═══════════════════════════════════════════════════════════════════════
configureGlobalSettings(llm, embeddingModel);

// ═══════════════════════════════════════════════════════════════════════
//  加载文档 + 切分 + 构建向量索引
// ═══════════════════════════════════════════════════════════════════════

let index: VectorStoreIndex;
const hasExistingIndex = fs.existsSync(path.join(STORAGE_DIR, "docstore.json"));

if (hasExistingIndex) {
  console.log("📂 检测到已有持久化索引，直接加载...");
  const storageContext = await storageContextFromDefaults({ persistDir: STORAGE_DIR });
  index = await VectorStoreIndex.init({ storageContext });
  console.log("✅ 索引加载完成");
} else {
  let nodes: TextNode[];
  const hasCachedNodes = fs.existsSync(CACHE_NAIVE);

  if (hasCachedNodes) {
    console.log("📂 检测到切分缓存，直接加载...");
    const cached = JSON.parse(fs.readFileSync(CACHE_NAIVE, "utf-8"));
    nodes = cached.map(
      (item: { text: string; id_: string }) =>
        new TextNode({ text: item.text, id_: item.id_ }),
    );
    console.log(`📊 从缓存加载 ${nodes.length} 个 chunk`);
  } else {
    // Step 1: 加载文件
    const reader = new SimpleDirectoryReader();
    const documents = await reader.loadData({ directoryPath: FILE_DIR });
    console.log(`✅ 共加载 ${documents.length} 个文档`);
    const fullText = documents.map((d: Document) => d.text).join("\n\n");
    console.log(`📊 合并后总字符数: ${fullText.length}`);

    // Step 2: 切分
    const splitter = new LLMChunk({ chunkSize: 512, chunkOverlap: 20 });
    const chunks = await splitter.splitText(fullText);
    nodes = chunks.map((text, i) => new TextNode({ text, id_: `llm-chunk-${i}` }));
    console.log(`📊 切分出 ${nodes.length} 个 chunk`);

    // 缓存切分结果
    const cacheDir = path.dirname(CACHE_NAIVE);
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      CACHE_NAIVE,
      JSON.stringify(nodes.map((n) => ({ text: n.text, id_: n.id_ })).sort()),
      "utf-8",
    );
    console.log(`💾 切分结果已缓存到 ${CACHE_NAIVE}`);
  }

  // Step 3: 向量化 & 建索引
  console.log("⏳ 正在生成 embedding 并构建向量索引...");
  const storageContext = await storageContextFromDefaults({ persistDir: STORAGE_DIR });
  index = await VectorStoreIndex.init({ nodes, storageContext });
  console.log("✅ 向量数据库构建完成");
  console.log(`   📦 节点数: ${nodes.length}`);
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 4a: Query Analyzer — 分析问题复杂度
// ═══════════════════════════════════════════════════════════════════════
async function analyzeQuery(query: string): Promise<Analysis> {
  const prompt = `分析以下用户问题的复杂度，返回分类结果。

分类标准：
- simple: 简单事实性问题、问候、闲聊，不需要检索或一次简单检索就能回答
  如："什么是CRISPE框架"、"你好"、"今天天气如何"
  特征：问题明确、单一概念、不需要跨片段推理

- medium: 需要基于文档内容进行推理的问题
  如："CRISPE框架和BROKE框架有什么区别"、"CoT有哪些应用场景"
  特征：需要比较、需要综合多个信息、涉及多个概念的关系

- complex: 需要多步推理的复杂问题
  如："对比三种提示词框架的优缺点，并说明哪种适合新手"、"如果我想提高模型推理能力，应该选择哪种技术？为什么？"
  特征：需要多步分析、需要评估和推荐、有"如果...那么..."的条件推理

输出格式（只输出以下两行，不要多余内容）:
复杂度: simple
理由: xxx

问题: ${query}

复杂度:`;

  const resp = await llm.chat({
    messages: [{ role: "user", content: prompt }],
  });
  const raw = (resp.message.content as string).trim();

  // 解析复杂度
  const complexityLine = raw.split("\n")[0] || "";
  const complexity: Complexity =
    complexityLine.includes("medium") ? "medium"
    : complexityLine.includes("complex") ? "complex"
    : "simple";

  // 解析理由
  const reasonLine = raw.split("\n")[1] || "";
  const reason = reasonLine.replace("理由:", "").trim();

  return { complexity, reason };
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 4b: 向量检索（通用函数）
// ═══════════════════════════════════════════════════════════════════════
async function retrieve(query: string, topK: number): Promise<RetrievedDoc[]> {
  const retriever = index.asRetriever({ similarityTopK: topK });
  const nodes = await retriever.retrieve({ query });

  return nodes.map((node) => ({
    text: (node.node as TextNode).text,
    score: node.score ?? 0,
  }));
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 4c: 三种检索策略
// ═══════════════════════════════════════════════════════════════════════

/**
 * simple 策略：直接 LLM 回答 + 简单检索作为上下文
 * 适用于简单事实性问题，LLM 自身知识就足够回答
 */
async function simpleRAG(query: string): Promise<string> {
  console.log("   📋 策略: simple — 简单问题，直接回答");

  // 做一次简单检索，给 LLM 可选的参考上下文
  const docs = await retrieve(query, RETRIEVAL_CONFIG.simpleTopK);

  let prompt: string;
  if (docs.length > 0) {
    prompt = `请回答以下用户问题。

【参考信息】（可能相关，辅助回答）
${docs.map((d, i) => `[${i + 1}] ${d.text}`).join("\n\n")}

【用户问题】
${query}

注意：
- 如果你确定答案，直接回答即可，无需提及参考信息
- 如果参考信息中有相关内容，可以引用
- 如果问题不在你的知识范围内，请说明"我不确定"`;
  } else {
    prompt = `请简洁地回答以下问题。如果你不知道答案，请说明"我不确定"。

${query}`;
  }

  const resp = await llm.chat({
    messages: [{ role: "user", content: prompt }],
  });
  return resp.message.content as string;
}

/**
 * medium 策略：单步 RAG — 检索 → 生成
 * 适用于需要基于文档推理的问题
 */
async function mediumRAG(query: string): Promise<string> {
  console.log("   📋 策略: medium — 中等复杂度，单步 RAG");
  const docs = await retrieve(query, RETRIEVAL_CONFIG.mediumTopK);
  console.log(`      ✅ 检索到 ${docs.length} 个相关片段`);

  const context = docs
    .map((d, i) => `[文档片段 ${i + 1}]（相关度: ${(d.score * 100).toFixed(1)}%）\n${d.text}`)
    .join("\n\n---\n\n");

  const prompt = `请基于以下检索到的文档信息，准确、简洁地回答用户问题。

【检索结果】
${context}

【用户问题】
${query}

注意：
- 优先使用检索到的信息回答问题
- 如果信息不足，请说明"未找到相关信息"
- 如果多个来源信息有冲突，请指出并给出你的判断`;

  const resp = await llm.chat({
    messages: [{ role: "user", content: prompt }],
  });
  return resp.message.content as string;
}

/**
 * complex 策略：多步迭代检索 — 检索 → 精炼查询 → 再检索 → 生成
 * 适用于需要多步推理的复杂问题
 */
async function complexRAG(query: string): Promise<string> {
  console.log("   📋 策略: complex — 复杂问题，多步迭代检索");

  // ─── Round 1: 首次检索 ───────────────────────────────────────────
  console.log("      🔄 [Round 1/2] 首次检索...");
  const docs1 = await retrieve(query, RETRIEVAL_CONFIG.complexFirstK);
  console.log(`         ✅ 检索到 ${docs1.length} 个片段`);

  if (docs1.length === 0) {
    // 没有检索到任何内容，降级为直接回答
    console.log("      ⚠️  首次检索无结果，降级为简单回答");
    const resp = await llm.chat({
      messages: [{ role: "user", content: `请回答: ${query}` }],
    });
    return resp.message.content as string;
  }

  // ─── Round 2: LLM 精炼查询（基于首次检索结果）───────────────────
  console.log("      🔄 [精炼查询] 基于首次检索结果生成第二轮查询...");
  const context1 = docs1
    .map((d, i) => `[片段 ${i + 1}] ${d.text}`)
    .join("\n\n");

  const refinePrompt = `你正在进行多步检索。以下是第一轮检索到的文档片段和原始问题。
请基于这些信息，生成一个更精确的第二轮查询，以获取缺失的细节。

第一轮检索结果:
${context1}

原始问题: ${query}

分析：
1. 第一轮检索已经回答了问题的哪些部分？
2. 还缺少哪些信息？
3. 为了获取缺失的信息，第二轮应该搜索什么？

请直接输出第二轮查询（只输出查询文本本身，不要输出分析过程）:`;

  const refineResp = await llm.chat({
    messages: [{ role: "user", content: refinePrompt }],
  });
  const refinedQuery = (refineResp.message.content as string).trim();
  console.log(`         🔑 精炼查询: "${refinedQuery.slice(0, 100)}${refinedQuery.length > 100 ? "..." : ""}"`);

  // ─── Round 3: 二次检索 ───────────────────────────────────────────
  console.log("      🔄 [Round 2/2] 二次检索...");
  const docs2 = await retrieve(refinedQuery, RETRIEVAL_CONFIG.complexSecondK);
  console.log(`         ✅ 检索到 ${docs2.length} 个片段`);

  // ─── 合并去重：剔除与第一轮重复的片段 ──────────────────────────
  const allTexts = new Set<string>();
  const mergedDocs: RetrievedDoc[] = [];
  for (const doc of [...docs1, ...docs2]) {
    // 去掉首尾空格和换行后比较
    const normalized = doc.text.trim().slice(0, 100);
    if (!allTexts.has(normalized)) {
      allTexts.add(normalized);
      mergedDocs.push(doc);
    }
  }
  console.log(`      📊 合并后 ${mergedDocs.length} 个唯一片段（第一轮 ${docs1.length} + 第二轮 ${docs2.length}）`);

  // ─── 最终生成 ─────────────────────────────────────────────────────
  const mergedContext = mergedDocs
    .map((d, i) => `[片段 ${i + 1}]（相关度: ${(d.score * 100).toFixed(1)}%）\n${d.text}`)
    .join("\n\n---\n\n");

  const finalPrompt = `请基于以下两轮检索到的文档信息，全面、准确地回答用户问题。

【检索结果】
${mergedContext}

【用户问题】
${query}

注意：
- 综合两轮检索的信息来回答问题
- 如果信息不足，请说明"未找到相关信息"
- 如果多个来源信息有冲突，请指出并给出你的判断`;

  const resp = await llm.chat({
    messages: [{ role: "user", content: finalPrompt }],
  });
  return resp.message.content as string;
}

// ═══════════════════════════════════════════════════════════════════════
//  主入口：查询路由
// ═══════════════════════════════════════════════════════════════════════
async function adaptiveQuery(query: string): Promise<{
  complexity: Complexity;
  reason: string;
  answer: string;
}> {
  // Step 1: 分析问题复杂度
  const { complexity, reason } = await analyzeQuery(query);
  console.log(`   📊 分类: ${complexity}（${reason}）`);

  // Step 2: 根据复杂度路由到不同策略
  let answer: string;
  switch (complexity) {
    case "simple":
      answer = await simpleRAG(query);
      break;
    case "medium":
      answer = await mediumRAG(query);
      break;
    case "complex":
      answer = await complexRAG(query);
      break;
  }

  return { complexity, reason, answer };
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 5: 聊天循环
// ═══════════════════════════════════════════════════════════════════════
console.log("\n");
console.log("═".repeat(60));
console.log("🤖 Adaptive RAG 已就绪！输入问题开始对话，输入 exit 退出");
console.log("═".repeat(60));
console.log("💡 系统会自动根据问题复杂度选择策略：");
console.log("   • simple   — 直接回答（问候、简单事实性问题）");
console.log("   • medium   — 单步 RAG（需要推理的问题）");
console.log("   • complex  — 多步迭代检索（复杂推理问题）");
console.log("─".repeat(60));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(): Promise<string> {
  return new Promise((resolve) => {
    rl.question("👤 你: ", (answer) => {
      resolve(answer.trim());
    });
  });
}

async function chatLoop() {
  while (true) {
    let query: string;
    try {
      query = await prompt();
    } catch {
      break;
    }
    if (!query || query.toLowerCase() === "exit" || query.toLowerCase() === "quit") {
      console.log("\n👋 再见！");
      rl.close();
      tokenTracker.printUsage();
      break;
    }

    console.log("⏳ 思考中...\n");
    try {
      const { complexity, answer } = await adaptiveQuery(query);

      const strategyLabel =
        complexity === "simple" ? "直接回答"
        : complexity === "medium" ? "单步 RAG"
        : "多步迭代检索";

      console.log(`\n🤖 Agent [${strategyLabel}]: ${answer}`);
      console.log("");
    } catch (err) {
      console.error("❌ 出错:", err);
    }
  }
}

chatLoop();