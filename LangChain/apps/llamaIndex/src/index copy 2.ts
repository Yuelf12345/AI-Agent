/**
 * RAG Crash Course - Part 1: Foundations of RAG Systems
 *
 * 基于 Daily Dose of Data Science 的 RAG 速成课程 Part 1 实现
 * 演示完整的 RAG 系统工作流程（7 步）：
 *
 *  Step 1: 创建分块 (Chunking)
 *  Step 2: 生成嵌入 (Embedding)
 *  Step 3: 存储到向量数据库 (Vector Store)
 *  Step 4: 用户输入查询 (User Query)
 *  Step 5: 嵌入查询 (Query Embedding)
 *  Step 6: 检索相似分块 (Retrieve Similar Chunks)
 *  Step 7: 重排序分块 (Re-ranking with Cross-encoder)
 *
 * 使用框架：LlamaIndex + OpenAI Embedding + Qdrant (可选)
 */

import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// ─── LlamaIndex 核心模块 ────────────────────────────────────────────
import { SimpleDirectoryReader } from "@llamaindex/readers/directory";
import { Document, TextNode } from "@llamaindex/core/schema";
import {
  VectorStoreIndex,
  storageContextFromDefaults,
} from "llamaindex";
import { OpenAIEmbedding } from "@llamaindex/openai";
import { Settings } from "@llamaindex/core/global";
import {
  SentenceSplitter,
  SentenceWindowNodeParser,
} from "@llamaindex/core/node-parser";

// ─── 本地模块 ────────────────────────────────────────────────────────
import llm from "./llm.ts";
import SemanticSplitter from "./SemanticSplitter.js";

// ─── 路径配置 ────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILE_DIR = path.resolve(__dirname, "../files");

// ─── 切分策略枚举 ────────────────────────────────────────────────────
type ChunkingStrategy = "sentence" | "semantic" | "window";

// ═══════════════════════════════════════════════════════════════════════
//  Step 0: 全局配置 — 设置 Embedding 模型和 LLM
// ═══════════════════════════════════════════════════════════════════════
function configureSettings() {
  Settings.embedModel = new OpenAIEmbedding({
    model: "text-embedding-v3", // 阿里云通义千问 embedding 模型
  });
  Settings.llm = llm;
  console.log("⚙️  全局配置完成 — Embedding: text-embedding-v3, LLM: 已就绪");
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 1: 创建分块 (Chunking)
//  — 将外部知识拆分为小块，以适配嵌入模型的输入大小
//  — 支持三种切分策略：句子切分、语义切分、滑动窗口
// ═══════════════════════════════════════════════════════════════════════
async function createChunks(
  documents: Document[],
  strategy: ChunkingStrategy = "sentence"
): Promise<TextNode[]> {
  console.log(`\n📝 Step 1: 创建分块 (策略: ${strategy})`);
  console.log("─".repeat(50));

  let nodes: TextNode[];

  switch (strategy) {
    case "sentence": {
      // ── 句子切分 ──
      // 按固定大小切分，保留句子完整性
      const splitter = new SentenceSplitter({
        chunkSize: 512, // 每个分块的最大 token 数
        chunkOverlap: 50, // 相邻分块的重叠 token 数（保持上下文连贯）
      });
      nodes = await splitter.getNodesFromDocuments(documents);
      break;
    }

    case "semantic": {
      // ── 语义切分 ──
      // 先按段落/标题切，再在语义跳变处断开
      const semanticSplitter = new SemanticSplitter();
      nodes = await semanticSplitter.splitDocuments(documents);
      break;
    }

    case "window": {
      // ── 滑动窗口切分 ──
      // 每个节点只存储一小段文本，但检索时返回周围窗口内的上下文
      const parser = new SentenceWindowNodeParser({
        windowSize: 3, // 窗口大小：前后各 3 句
        windowMetadataKey: "window", // 窗口上下文存储的 metadata key
        originalTextMetadataKey: "original_text",
      });
      nodes = await parser.getNodesFromDocuments(documents);
      break;
    }

    default:
      throw new Error(`未知的切分策略: ${strategy}`);
  }

  console.log(`✅ 切分为 ${nodes.length} 个 chunk`);
  nodes.slice(0, 3).forEach((node, i) => {
    console.log(
      `  [${i + 1}] ${node.text.slice(0, 60).replace(/\n/g, " ")}... (${
        node.text.length
      } 字符)`
    );
  });
  if (nodes.length > 3) console.log(`  ... 还有 ${nodes.length - 3} 个 chunk`);

  return nodes;
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 2 & 3: 生成嵌入 + 存储到向量数据库
//  — LlamaIndex 的 VectorStoreIndex 会自动完成：
//    Step 2: 对每个 chunk 调用 embedding model 生成向量
//    Step 3: 将向量存入内存中的向量存储（可替换为 Qdrant/Pinecone 等）
// ═══════════════════════════════════════════════════════════════════════
async function buildVectorIndex(
  nodes: TextNode[]
): Promise<VectorStoreIndex> {
  console.log("\n📊 Step 2 & 3: 生成嵌入 + 构建向量索引");
  console.log("─".repeat(50));
  console.log(
    "  → 对每个 chunk 调用 embedding model 生成向量嵌入..."
  );
  console.log(
    "  → 将向量嵌入存入内存向量存储 (可扩展为 Qdrant/Pinecone)..."
  );

  const index = await VectorStoreIndex.init({ nodes });

  console.log("✅ 向量索引构建完成");
  return index;
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 4-6: 查询 → 嵌入查询 → 检索相似分块
//  — VectorStoreIndex.asQueryEngine() 封装了：
//    Step 4: 接收用户查询
//    Step 5: 用同一个 embedding model 嵌入查询
//    Step 6: 用近似最近邻(ANN)搜索检索最相似的 k 个 chunk
// ═══════════════════════════════════════════════════════════════════════
async function retrieveChunks(
  index: VectorStoreIndex,
  query: string,
  topK: number = 3
) {
  console.log(`\n🔍 Step 4-6: 查询 → 嵌入查询 → 检索相似分块`);
  console.log("─".repeat(50));
  console.log(`  Step 4: 用户查询 = "${query}"`);
  console.log(`  Step 5: 用 embedding model 嵌入查询向量...`);
  console.log(
    `  Step 6: ANN 搜索检索最相似的 ${topK} 个 chunk...`
  );

  // 使用 retriever 获取原始检索结果（不经过 LLM 生成）
  const retriever = index.asRetriever({ similarityTopK: topK });
  const retrievedNodes = await retriever.retrieve({ query });

  console.log(`✅ 检索到 ${retrievedNodes.length} 个相关 chunk:`);
  retrievedNodes.forEach((node, i) => {
    const score = node.score?.toFixed(4) || "N/A";
    console.log(
      `  [${i + 1}] 相似度: ${score} | ${node.node.text
        .slice(0, 80)
        .replace(/\n/g, " ")}...`
    );
  });

  return retrievedNodes;
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 7: 重排序 (Re-ranking)
//  — 使用 Cross-encoder 对检索到的 chunk 进行精细重排序
//  — Cross-encoder 同时编码 query + chunk，计算更准确的相关性分数
//  — 这里使用 LLM 作为 re-ranker 的替代方案（通过 prompt 判断相关性）
// ═══════════════════════════════════════════════════════════════════════
async function rerankChunks(
  query: string,
  retrievedNodes: any[],
  topN: number = 2
): Promise<any[]> {
  console.log(`\n🔄 Step 7: 重排序 (Re-ranking)`);
  console.log("─".repeat(50));
  console.log(
    "  → 使用 LLM 作为 Cross-encoder 替代，对每个 chunk 评分..."
  );

  // 对每个 chunk，让 LLM 评估其与 query 的相关性
  const scoredChunks: { node: any; score: number }[] = [];

  for (const result of retrievedNodes) {
    const chunkText = result.node.text;
    const prompt = `请评估以下文档片段与查询的相关性，只返回一个 0-10 的数字（10=完全相关，0=完全无关），不要返回其他任何内容。

查询: ${query}

文档片段:
${chunkText}

相关性评分 (0-10):`;

    try {
      const response = await llm.chat({
        messages: [{ role: "user", content: prompt }],
      });
      const scoreStr = response.message.content.toString().trim();
      const score = parseFloat(scoreStr);
      if (!isNaN(score) && score >= 0 && score <= 10) {
        scoredChunks.push({ node: result, score: score / 10 });
      } else {
        // 如果解析失败，使用原始相似度分数
        scoredChunks.push({
          node: result,
          score: result.score || 0.5,
        });
      }
    } catch {
      scoredChunks.push({ node: result, score: result.score || 0.5 });
    }
  }

  // 按相关性分数降序排列
  scoredChunks.sort((a, b) => b.score - a.score);
  const topChunks = scoredChunks.slice(0, topN);

  console.log(`✅ 重排序后 top ${topN} 个 chunk:`);
  topChunks.forEach((item, i) => {
    console.log(
      `  [${i + 1}] 评分: ${item.score.toFixed(4)} | ${item.node.node.text
        .slice(0, 80)
        .replace(/\n/g, " ")}...`
    );
  });

  return topChunks.map((item) => item.node);
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 8 (补充): 生成最终响应
//  — 将重排序后的 chunk + 用户查询组合为 prompt → 发送给 LLM 生成回答
// ═══════════════════════════════════════════════════════════════════════
async function generateResponse(
  query: string,
  rerankedChunks: any[]
): Promise<string> {
  console.log(`\n🤖 Step 8: 生成最终响应`);
  console.log("─".repeat(50));

  // 组装上下文
  const context = rerankedChunks
    .map((chunk, i) => `[${i + 1}] ${chunk.node.text}`)
    .join("\n\n");

  const prompt = `请基于以下参考文档回答用户的问题。如果参考文档中没有相关信息，请说明。

参考文档:
${context}

用户问题: ${query}

回答:`;

  const response = await llm.chat({
    messages: [{ role: "user", content: prompt }],
  });

  return response.message.content.toString();
}

// ═══════════════════════════════════════════════════════════════════════
//  便捷方法：使用 LlamaIndex 内置的 QueryEngine（一步完成 Step 4-8）
// ═══════════════════════════════════════════════════════════════════════
async function queryWithEngine(
  index: VectorStoreIndex,
  query: string,
  topK: number = 3
) {
  console.log(`\n⚡ 便捷方法: 使用 LlamaIndex QueryEngine (Step 4-8 一体化)`);
  console.log("─".repeat(50));

  const queryEngine = index.asQueryEngine({
    similarityTopK: topK,
  });

  const response = await queryEngine.query({ query });

  console.log(`\n🤖 回答: ${response.toString()}`);

  console.log("\n📎 参考来源:");
  response.sourceNodes?.forEach((node, i) => {
    const score = node.score?.toFixed(4) || "N/A";
    console.log(
      `  [${i + 1}] 相似度: ${score} | ${node.node.text
        .slice(0, 80)
        .replace(/\n/g, " ")}...`
    );
  });

  return response;
}

// ═══════════════════════════════════════════════════════════════════════
//  辅助函数：加载文档
// ═══════════════════════════════════════════════════════════════════════
async function loadDocuments(): Promise<Document[]> {
  console.log("\n📂 加载外部知识文档...");
  console.log("─".repeat(50));

  const reader = new SimpleDirectoryReader();
  const documents = await reader.loadData({
    directoryPath: FILE_DIR,
  });

  console.log(`✅ 共加载 ${documents.length} 个文档`);

  // 打印文档信息
  documents.forEach((doc: Document, i: number) => {
    const preview = doc.text.slice(0, 50).replace(/\n/g, " ");
    console.log(
      `  [${i + 1}] ${doc.id_ || "N/A"} — ${preview}... (${doc.text.length} 字符)`
    );
  });

  return documents;
}

// ═══════════════════════════════════════════════════════════════════════
//  演示：对比不同切分策略
// ═══════════════════════════════════════════════════════════════════════
async function compareChunkingStrategies(documents: Document[]) {
  console.log("\n\n" + "═".repeat(60));
  console.log("  🔬 对比不同切分策略");
  console.log("═".repeat(60));

  const strategies: ChunkingStrategy[] = ["sentence", "semantic"];

  for (const strategy of strategies) {
    console.log(`\n\n┌─────────────────────────────────────────────┐`);
    console.log(`  策略: ${strategy}`);
    console.log(`└─────────────────────────────────────────────┘`);

    const nodes = await createChunks(documents, strategy);

    // 统计信息
    const lengths = nodes.map((n) => n.text.length);
    const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const minLen = Math.min(...lengths);
    const maxLen = Math.max(...lengths);

    console.log(`\n📊 统计信息:`);
    console.log(`  分块数量: ${nodes.length}`);
    console.log(`  平均长度: ${avgLen.toFixed(0)} 字符`);
    console.log(`  最短: ${minLen} 字符 | 最长: ${maxLen} 字符`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  主函数：完整 RAG 流程演示
// ═══════════════════════════════════════════════════════════════════════
async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  RAG Crash Course — Part 1: Foundations of RAG Systems  ║");
  console.log("║  基于 Daily Dose of Data Science 速成课程实现            ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // ── Step 0: 全局配置 ──
  configureSettings();

  // ── 加载文档 ──
  const documents = await loadDocuments();

  // ── 对比不同切分策略 ──
  await compareChunkingStrategies(documents);

  // ════════════════════════════════════════════════════════════
  //  完整 RAG 流程演示 (7 步 + 生成响应)
  // ════════════════════════════════════════════════════════════
  console.log("\n\n" + "═".repeat(60));
  console.log("  🚀 完整 RAG 流程演示");
  console.log("═".repeat(60));

  const query = "CoT是什么";

  // Step 1: 创建分块（使用句子切分策略）
  const nodes = await createChunks(documents, "sentence");

  // Step 2 & 3: 生成嵌入 + 构建向量索引
  const index = await buildVectorIndex(nodes);

  // Step 4-6: 查询 → 嵌入查询 → 检索相似分块
  const retrievedNodes = await retrieveChunks(index, query, 5);

  // Step 7: 重排序
  const rerankedChunks = await rerankChunks(query, retrievedNodes, 3);

  // Step 8: 生成最终响应
  const answer = await generateResponse(query, rerankedChunks);
  console.log(`\n🎯 最终回答: ${answer}`);

  // ════════════════════════════════════════════════════════════
  //  便捷方法演示：LlamaIndex 内置 QueryEngine
  // ════════════════════════════════════════════════════════════
  console.log("\n\n" + "═".repeat(60));
  console.log("  ⚡ 便捷方法: LlamaIndex 内置 QueryEngine");
  console.log("═".repeat(60));

  await queryWithEngine(index, "什么是提示工程？");

  console.log("\n\n✅ RAG Part 1 演示完成！");
}

// ─── 执行 ─────────────────────────────────────────────────────────────
main().catch(console.error);
