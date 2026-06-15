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
import * as readline from "readline";

// ─── LlamaIndex 核心模块 ────────────────────────────────────────────
import { SimpleDirectoryReader } from "@llamaindex/readers/directory";
import { Document, TextNode } from "@llamaindex/core/schema";
import {
  VectorStoreIndex,
  storageContextFromDefaults,
  QueryEngineTool,
} from "llamaindex";
import { OpenAIEmbedding } from "@llamaindex/openai";
import { Settings } from "@llamaindex/core/global";
import { ReActAgent } from "llamaindex/agent";

// ─── 本地模块 ────────────────────────────────────────────────────────
import llm from "./llm.ts";
import { FixedSizeChunk, SemanticChunk, RecursiveChunk, LLMChunk, SentenceSplitter, TokenTextSplitter, SentenceWindowNodeParser  } from "./check/index.ts";

// ─── 路径配置 ────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILE_DIR = path.resolve(__dirname, "../files");
const STORAGE_DIR = path.resolve(__dirname, "../storage");
const CACHE_FILE = path.resolve(__dirname, "../cache", "nodes.json");

//  Step 0: 全局配置 — 设置 Embedding 模型和 LLM
// ═══════════════════════════════════════════════════════════════════════
function configureSettings() {
  Settings.embedModel = new OpenAIEmbedding({
    model: "text-embedding-v3", // 阿里云通义千问 embedding 模型
  });
  Settings.llm = llm;
  console.log("⚙️  全局配置完成 — Embedding: text-embedding-v3, LLM: 已就绪");
}

// Step0: 全局配置
configureSettings();

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
  const hasCachedNodes = fs.existsSync(CACHE_FILE);

  if (hasCachedNodes) {
    console.log("📂 检测到切分缓存，直接加载...");
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
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
    const cacheDir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify(nodes.map((n) => ({ text: n.text, id_: n.id_ })).sort()),
      "utf-8",
    );
    console.log(`💾 切分结果已缓存到 ${CACHE_FILE}`);
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
//  Step 4: 构建 ReAct Agent — 智能路由
// ═══════════════════════════════════════════════════════════════════════
//
//  🔑 核心改进：用 Agent 替代纯 QueryEngine
//
//  旧方式（问题）：queryEngine.query() → 每次查询都走 RAG 检索
//    - "你是谁" → 也会检索文档 → 用 BROKE 框架来回答 ❌
//
//  新方式（解决）：ReActAgent + QueryEngineTool
//    - "什么是CRISPE框架" → Agent 判断需要检索 → 调用 RAG 工具 ✅
//    - "你是谁" → Agent 判断是通用问题 → 直接用自身知识回答 ✅
//
//  Agent 的路由判断由 LLM 完成：
//    - 看到 tool 的 description 后，LLM 会自主决定是否需要调用
//    - 文档相关 → 调用 knowledge_base_tool
//    - 通用问题 → 不调用任何 tool，直接回答
// ═══════════════════════════════════════════════════════════════════════

const knowledgeBaseTool = new QueryEngineTool({
  queryEngine: index.asQueryEngine({ similarityTopK: 3 }),
  metadata: {
    name: "knowledge_base_tool",
    description: `这是一个提示词工程知识库检索工具。当用户的问题与以下内容相关时，请使用此工具：
- 提示词工程（Prompt Engineering）相关的概念、技巧和最佳实践
- 提示词框架，如 CRISPE、BROKE、COSTAR、RISEN、APE、RASCEF、TAG、RACE 等
- 提示词设计方法和原则
- 文档中提到的具体提示词示例

当用户的问题与上述文档知识无关时（例如闲聊、通用知识问答、编程问题等），请不要使用此工具，直接用你自己的知识回答。`,
  },
  includeSourceNodes: true,
});

const agent = new ReActAgent({
  tools: [knowledgeBaseTool],
  llm,
  verbose: true,
});

// ═══════════════════════════════════════════════════════════════════════
//  Step 5: 交互式 REPL — 支持多轮对话
// ═══════════════════════════════════════════════════════════════════════
console.log("\n🤖 Agent 已就绪！输入问题开始对话，输入 exit 退出");
console.log("─".repeat(60));
console.log("💡 试试这些问题:");
console.log("   • 什么是CRISPE框架  (文档问题 → 走 RAG)");
console.log("   • 你是谁             (通用问题 → 直接回答)");
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
      // readline 已关闭（如 pipe 输入结束）
      break;
    }
    if (!query || query.toLowerCase() === "exit" || query.toLowerCase() === "quit") {
      console.log("\n👋 再见！");
      rl.close();
      break;
    }

    console.log("⏳ 思考中...\n");
    try {
      const response = await agent.chat({ message: query });
      console.log(`\n🤖 Agent: ${response.message.content}`);
      console.log("");
    } catch (err) {
      console.error("❌ 出错:", err);
    }
  }
}

chatLoop();
