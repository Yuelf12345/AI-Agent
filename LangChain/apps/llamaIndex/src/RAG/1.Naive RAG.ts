/**
 * RAG Crash Course - Part 1: Foundations of RAG Systems
 *
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
import { Settings } from "@llamaindex/core/global";

// ─── 本地模块 ────────────────────────────────────────────────────────
import "../embedding.ts";
import llm, { tokenTracker } from "../llm.ts";
import { FixedSizeChunk, SemanticChunk, RecursiveChunk, LLMChunk, SentenceSplitter, TokenTextSplitter, SentenceWindowNodeParser  } from "../check/index.ts";
import { FILE_DIR, STORAGE_DIR, CACHE_NAIVE } from "../constants.ts";

//  Step 0: 全局配置 — 设置 LLM（Embedding 已在 embedding.ts 中自动配置）
// ═══════════════════════════════════════════════════════════════════════
Settings.llm = llm;
console.log(`      LLM: ${process.env.LOCAL ? "本地 (Ollama qwen2.5:7b)" : "云端 (阿里云 qwen-plus)"}`);

// ═══════════════════════════════════════════════════════════════════════
//  缓存检查：如果已有持久化索引，直接加载，跳过整个构建流程
// ═══════════════════════════════════════════════════════════════════════
const storageContext = await storageContextFromDefaults({ persistDir: STORAGE_DIR });

let index: VectorStoreIndex;
const hasExistingIndex = fs.existsSync(path.join(STORAGE_DIR, "docstore.json"));

if (hasExistingIndex) {
  console.log("📂 检测到已有持久化索引，直接加载...");
  index = await VectorStoreIndex.init({ storageContext });
  console.log(`✅ 索引加载完成`);
} else {
  // 没有持久化索引 → 加载或构建节点

  // ═══════════════════════════════════════════════════════════════════
  //  Step 1-2: 加载文件 + 切分（优先从缓存加载）
  // ═══════════════════════════════════════════════════════════════════
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

    // 缓存切分结果（避免下次重新 LLM 切分）
    const cacheDir = path.dirname(CACHE_NAIVE);
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      CACHE_NAIVE,
      JSON.stringify(nodes.map((n) => ({ text: n.text, id_: n.id_ })).sort()),
      "utf-8",
    );
    console.log(`💾 切分结果已缓存到 ${CACHE_NAIVE}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Step 3: 向量化 & 建索引（含持久化）
  // ═══════════════════════════════════════════════════════════════════
  console.log("⏳ 正在生成 embedding 并构建向量索引...");
  index = await VectorStoreIndex.init({ nodes, storageContext });
  console.log(`✅ 向量数据库构建完成`);
  console.log(`   📦 节点数: ${nodes.length}`);
  console.log(`   💾 持久化路径: ${STORAGE_DIR}`);
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 4: 构建 RAG QA Chain — 检索
/**
 * 在自然语言处理中有文本检索技术，分为：
  1. 稀疏文本检索（Sparse Retrieval）
  2. 稠密文本检索（Dense Retrieval）
  在现行的 RAG 语境下，更多是使用了向量化搜索，也就是稠密文本检索的方式。
 */
// ═══════════════════════════════════════════════════════════════════════
const queryEngine = index.asQueryEngine({ similarityTopK: 3 });

// const query = "什么是CRISPE框架";
// console.log(`\n🔍 用户查询: "${query}"`);
// console.log("⏳ 正在检索并生成回答...\n");

// const response = await queryEngine.query({ query });

// console.log("─── 回答 ───");
// console.log(response.message.content);
// console.log("");

// const sourceNodes = response.sourceNodes ?? [];
// console.log(`📎 引用 ${sourceNodes.length} 个相关 chunk 作为上下文:`);
// sourceNodes.forEach((nodeWithScore, i) => {
//   const score = nodeWithScore.score ?? 0;
//   console.log(`  [${i}] 相似度: ${(score * 100).toFixed(1)}%`);
//   console.log(`      ${nodeWithScore.node.text.slice(0, 100)}...`);
// });
// console.log("\n✅ RAG 查询完成");

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
      // readline 已关闭（如 pipe 输入结束）
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
      const response = await queryEngine.query({ query });
      console.log(`\n🤖 Agent: ${response.message.content}`);
      console.log("");
    } catch (err) {
      console.error("❌ 出错:", err);
    }
  }
}

chatLoop();