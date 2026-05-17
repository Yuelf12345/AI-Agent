/**
 * RAG 增强功能测试脚本
 * 
 * 测试 BM25 和 Reranker：
 *   Step 1: BM25 vs TF — 关键词检索对比
 *   Step 2: Reranker — 重排序效果对比
 *   Step 3: 集成到 RAGPipeline — 完整流程
 * 
 * 运行方式：
 *   tsx src/Harness/test/test-rag-enhanced.ts
 * 
 * 前置条件：
 *   Chroma 服务运行中: chroma run --host localhost --port 8000
 */

import { Document } from "@langchain/core/documents";
import { BM25Retriever } from "../src/services/rag/bm25.ts";
import { Reranker } from "../src/services/rag/reranker.ts";
import { RAGPipeline } from "../src/services/rag/pipeline.ts";

function separator(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(60)}\n`);
}

// ==================== 测试文档 ====================

const TEST_DOCUMENTS: Document[] = [
  new Document({
    pageContent: "RAG（检索增强生成）是一种结合信息检索与文本生成的技术架构。核心思想是在LLM生成回答之前，先从外部知识库中检索相关信息。RAG解决了LLM的三大问题：知识时效性、私有数据访问和幻觉问题。",
    metadata: { source: "rag-intro.md", topic: "RAG" },
  }),
  new Document({
    pageContent: "Embedding（嵌入）是将文本转换为数值向量的技术。语义相似的文本向量距离近，语义不同的文本向量距离远。常用模型包括nomic-embed-text和text-embedding-3-small。",
    metadata: { source: "embedding-intro.md", topic: "Embedding" },
  }),
  new Document({
    pageContent: "LangChain是一个流行的AI应用开发框架，提供了Model I/O、Retrieval、Chains、Agents、Memory等核心模块。LangChain.js是TypeScript版本，支持OpenAI和Ollama。",
    metadata: { source: "langchain-intro.md", topic: "LangChain" },
  }),
  new Document({
    pageContent: "ReAct（Reasoning + Acting）是一种让AI Agent先思考再行动的模式。ReAct循环包括Thought、Action、Observation三个步骤，通过工具与外部世界交互获取实时数据。",
    metadata: { source: "react-intro.md", topic: "ReAct" },
  }),
  new Document({
    pageContent: "Chroma是开源向量数据库，支持相似度搜索和元数据过滤。Chroma vs Pinecone：本地免费vs云端收费；vs FAISS：有HTTP API vs纯计算库；vs Milvus：轻量vs大规模。",
    metadata: { source: "chroma-intro.md", topic: "Chroma" },
  }),
  new Document({
    pageContent: "BM25是信息检索领域最经典的排序算法，是TF-IDF的改进版本。BM25使用词频饱和函数控制tf影响上限，并用文档长度归一化避免长文档占优势。参数k1=1.2控制饱和度，b=0.75控制长度归一化。",
    metadata: { source: "bm25-intro.md", topic: "BM25" },
  }),
  new Document({
    pageContent: "Reranker是RAG流程中的精排环节。初次检索返回候选文档后，Reranker用更精确的方法重新排序。三种策略：CrossEncoder（LLM评分最准确）、ScoreFusion（分数融合最快）、Diversity（去重排序）。",
    metadata: { source: "reranker-intro.md", topic: "Reranker" },
  }),
];

// ==================== Step 1: BM25 vs TF ====================

async function testBM25() {
  separator("Step 1: BM25 vs TF — 关键词检索对比");

  const bm25 = new BM25Retriever();
  bm25.loadDocuments(TEST_DOCUMENTS);

  // BM25 统计
  const stats = bm25.getStats();
  console.log(`BM25 语料库统计: ${stats.docCount} 文档, 平均长度 ${stats.avgDocLength.toFixed(1)} 词, ${stats.uniqueTerms} 独立词项`);

  // 搜索测试
  const queries = ["RAG 检索增强", "BM25 排序算法", "向量数据库 Chroma", "LangChain 框架"];

  for (const query of queries) {
    console.log(`\n查询: "${query}"`);
    const results = bm25.search(query, 3);
    results.forEach(r => {
      console.log(`  [BM25] score=${r.score.toFixed(3)} topic=${r.doc.metadata?.topic} → ${r.doc.pageContent.slice(0, 50)}...`);
    });
  }

  // BM25 特点演示：精确关键词匹配
  console.log("\n--- BM25 精确关键词匹配优势 ---");
  console.log("搜索 'BM25'（精确术语）:");
  const bm25Results = bm25.search("BM25", 2);
  bm25Results.forEach(r => {
    console.log(`  score=${r.score.toFixed(3)} → ${r.doc.pageContent.slice(0, 60)}...`);
  });
}

// ==================== Step 2: Reranker ====================

async function testReranker() {
  separator("Step 2: Reranker — 重排序效果对比");

  // 模拟初检索结果（按向量检索分数排序）
  const candidates = TEST_DOCUMENTS.slice(0, 5).map((doc, i) => ({
    document: doc,
    score: 0.9 - i * 0.1, // 模拟分数递减
    metadata: doc.metadata as Record<string, unknown>,
    source: "vector" as const,
    finalScore: 0.9 - i * 0.1,
  }));

  // ScoreFusion 策略
  console.log("--- ScoreFusion 重排序 ---");
  const scoreFusion = new Reranker({ strategy: "score_fusion", finalTopK: 3 });
  const sfResults = await scoreFusion.rerank("什么是 RAG 检索增强生成", candidates);
  sfResults.forEach(r => {
    console.log(`  score=${r.finalScore.toFixed(3)} topic=${r.document.metadata?.topic} → ${r.document.pageContent.slice(0, 50)}...`);
    if (r.metadata?.rerankDetails) {
      const d = r.metadata.rerankDetails as any;
      console.log(`    详情: original=${d.originalScore?.toFixed(3)} keywordCoverage=${d.keywordCoverage?.toFixed(3)} positionBonus=${d.positionBonus?.toFixed(3)}`);
    }
  });

  // Diversity 策略
  console.log("\n--- Diversity 重排序 ---");
  const diversity = new Reranker({ strategy: "diversity", finalTopK: 3, diversityThreshold: 0.5 });
  const divResults = await diversity.rerank("RAG", candidates);
  divResults.forEach(r => {
    console.log(`  score=${r.finalScore.toFixed(3)} topic=${r.document.metadata?.topic} → ${r.document.pageContent.slice(0, 50)}...`);
  });

  // Cross-Encoder 策略（需要 LLM）
  console.log("\n--- Cross-Encoder 重排序（需要 LLM API）---");
  try {
    const crossEncoder = new Reranker({ strategy: "cross_encoder", finalTopK: 3 });
    const ceResults = await crossEncoder.rerank("什么是 RAG", candidates.slice(0, 3));
    ceResults.forEach(r => {
      console.log(`  score=${r.finalScore.toFixed(3)} topic=${r.document.metadata?.topic} → ${r.document.pageContent.slice(0, 50)}...`);
    });
  } catch (error: any) {
    console.log(`  ⚠️ Cross-Encoder 需要 LLM API: ${error.message}`);
  }
}

// ==================== Step 3: 集成到 RAGPipeline ====================

async function testIntegratedPipeline() {
  separator("Step 3: 集成到 RAGPipeline — BM25 + Rerank 完整流程");
  console.log("⚠️ 此步骤需要 Chroma 服务运行中");

  try {
    // 使用 BM25 + ScoreFusion Rerank 的 Pipeline
    const rag = new RAGPipeline({
      useBM25: true,
      rerankStrategy: "score_fusion",
    });

    await rag.reset();
    await rag.initialize();
    await rag.indexDocuments(TEST_DOCUMENTS);
    console.log(`索引完成，文档数量: ${await rag.getDocumentCount()}`);

    // 检索对比
    console.log("\n--- 检索模式对比 ---");

    // Hybrid 检索（无 Rerank）
    const hybridResults = await rag.retrieve("什么是 RAG", "hybrid");
    console.log(`\nHybrid 检索 (无 Rerank):`);
    hybridResults.forEach(r => {
      console.log(`  score=${r.finalScore.toFixed(3)} → ${r.document.pageContent.slice(0, 50)}...`);
    });

    // BM25 检索
    const bm25Results = await rag.retrieve("RAG 检索增强", "bm25");
    console.log(`\nBM25 检索:`);
    bm25Results.forEach(r => {
      console.log(`  score=${r.finalScore.toFixed(3)} → ${r.document.pageContent.slice(0, 50)}...`);
    });

    // 检索组件
    const components = rag.getComponents();
    console.log(`\nBM25 统计:`, components.bm25Retriever.getStats());
    console.log(`Reranker 配置:`, components.reranker?.getConfig());

  } catch (error: any) {
    console.log(`⚠️ Pipeline 测试失败: ${error.message}`);
    console.log("请确保 Chroma 服务正在运行");
  }
}

// ==================== Main ====================

async function main() {
  console.log("=== RAG 增强功能测试 ===\n");
  console.log("新增功能:");
  console.log("  1. BM25 — 经典关键词排序算法（替代简易 TF）");
  console.log("  2. Reranker — 初检后二次精排");
  console.log("     - CrossEncoder: LLM 评分（最准确）");
  console.log("     - ScoreFusion: 分数融合（最快）");
  console.log("     - Diversity: 去重排序");

  await testBM25();
  await testReranker();
  await testIntegratedPipeline();

  console.log("\n=== RAG 增强总结 ===");
  console.log("检索流程：初检索（粗排） → Rerank（精排） → Top-K（截断） → LLM");
  console.log("BM25 优势：精确关键词匹配 + IDF 权重 + 文档长度归一化");
  console.log("Reranker 优势：从候选中精选最相关文档，提升 LLM 输入质量");
}

main().catch(console.error);