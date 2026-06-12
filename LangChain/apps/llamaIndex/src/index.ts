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

// ─── 本地模块 ────────────────────────────────────────────────────────
import llm from "./llm.ts";
import { FixedSizeChunk, SemanticChunk, RecursiveChunk, LLMChunk, SentenceSplitter, TokenTextSplitter, SentenceWindowNodeParser  } from "./check/index.ts";

// ─── 路径配置 ────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILE_DIR = path.resolve(__dirname, "../files");

//  Step 0: 全局配置 — 设置 Embedding 模型和 LLM
// ═══════════════════════════════════════════════════════════════════════
function configureSettings() {
  Settings.embedModel = new OpenAIEmbedding({
    model: "text-embedding-v3", // 阿里云通义千问 embedding 模型
  });
  Settings.llm = llm;
  console.log("⚙️  全局配置完成 — Embedding: text-embedding-v3, LLM: 已就绪");
}

// Step0: 全局配置（必须在 SemanticChunk 之前，因为它依赖 Settings.embedModel）
configureSettings();

// Step1: 加载文件
const reader = new SimpleDirectoryReader();
// 使用 SimpleDirectoryReader 加载目录下的所有文档（含 PDF）
const documents = await reader.loadData({
  directoryPath: FILE_DIR,
});
console.log(`✅ 共加载 ${documents.length} 个文档`);
const fullText = documents.map((d: Document) => d.text).join("\n\n");
const mergedDoc = new Document({ text: fullText, id_: "merged-pdf" });
console.log(`📊 合并后总字符数: ${fullText.length}}`);

// Setp2: 切分
// {
//   const splitter = new SentenceWindowNodeParser({ windowSize: 2 });
//   const docs = [new Document({ text: fullText, id_: "merged-pdf" })];
//   const nodes = splitter.buildWindowNodesFromDocuments(docs);

//   console.log("🚀 开始切分文档...");
//   console.log(`📊 切分出 ${nodes.length} 个节点`);

//   // 写入文件：展示每个节点的 text + metadata.window
//   const outputPath = path.resolve(__dirname, "../output", `chunks-sentence-window-${Date.now()}.txt`);
//   const outputDir = path.dirname(outputPath);
//   if (!fs.existsSync(outputDir)) {
//     fs.mkdirSync(outputDir, { recursive: true });
//   }

//   let content = nodes
//     .map((node, i) => {
//       const windowText = node.metadata["window"] || "(无上下文)";
//       return [
//         `── node[${i}] (text: ${node.text.length}字, window: ${windowText.length}字) ──`,
//         `【当前句子】${node.text}`,
//         `【上下文窗口】${windowText}`,
//       ].join("\n");
//     })
//     .join("\n\n");

//   fs.writeFileSync(outputPath, content, "utf-8");
//   console.log(`✅ 已写入 ${outputPath}`);
// }
const splitter = new LLMChunk({ chunkSize: 512, chunkOverlap: 20 });
const nodes = await splitter.splitText(fullText);

console.log("🚀 开始切分文档...");
console.log(`📊 切分出 ${nodes.length} 个 chunk`);

// 写入文件
const outputPath = path.resolve(__dirname, "../output", `chunks-${Date.now()}.txt`);
const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

let content = nodes
  .map((chunk, i) => `── chunk[${i}] (${chunk.length}字) ──\n${chunk}`)
  .join("\n\n");
fs.writeFileSync(outputPath, content, "utf-8");
console.log(`✅ 已写入 ${outputPath}`);

