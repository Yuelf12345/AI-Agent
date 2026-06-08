{
  // import LlamaCloud from "@llamaindex/llama-cloud";
  // import fs from "fs";
  // import { z } from 'zod';
  // const ResumeSchema = z.object({
  //   input: z.string().describe('输入的问题'),
  // });
  // const client = new LlamaCloud({
  //   apiKey: process.env.LLAMAINDEX_API_KEY,
  // });
  // const file = await client.files.create({
  //   file: fs.createReadStream("./files/prompt.pdf"),
  //   purpose: "parse",
  // });
  // const result = await client.parsing.parse({
  //   file_id: file.id,
  //   tier: "agentic",
  //   version: "latest",
  //   expand: ["markdown"],
  // });
  // console.log(result.markdown?.pages);
}

{
  // import LlamaCloud from "@llamaindex/llama-cloud";
  // import fs from "fs";
  // const client = new LlamaCloud({
  //   apiKey: process.env.LLAMAINDEX_API_KEY,
  // });
  // const file = await client.files.create({
  //   file: fs.createReadStream("../files/prompt.pdf"),
  //   purpose: "parse",
  // });
  // /** 解析
  //    * tier:  层级 分别在成本、延迟和准确性之间进行权衡。
  //       fast— 基于规则、成本最低、无需人工智能
  //       cost_effective— 速度与质量兼顾
  //       agentic— 完全由人工智能驱动的解析
  //       agentic_plus— 具备专业功能的高级人工智能
  //   *
  //   */
  // const result = await client.parsing.parse({
  //   file_id: file.id,
  //   tier: "cost_effective",
  //   version: "latest",
  //   expand: ["markdown"],
  // });
  // console.log(result.markdown?.pages);
}

// 使用SimpleDirectoryReader 加载pdf文档
import path from "path";
import { fileURLToPath } from "url";
import { SimpleDirectoryReader } from "@llamaindex/readers/directory";
import { PDFReader } from "@llamaindex/readers/pdf";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILE_DIR = path.resolve(__dirname, "../files/pdf");

const reader = new SimpleDirectoryReader();

// 使用 SimpleDirectoryReader 加载目录下的所有文档（含 PDF）
const documents = await reader.loadData({
  directoryPath: FILE_DIR,
});

console.log(`✅ 共加载 ${documents.length} 个文档`);
// documents.forEach((doc, i) => {
//   console.log(`\n📄 文档 ${i + 1}:`);
//   console.log(`  文件名: ${doc.id_}`);
//   console.log(`  字符数: ${doc.text.length}`);
//   console.log(`  前 100 字: ${doc.text.slice(0, 100)}...`);
// });

{
  /**
    API	适用场景	优点	缺点
    SentenceSplitter ⭐	通用知识库	按句切分，语义完整；支持 chunk overlap 保证上下文连贯	-
    TokenTextSplitter	简单字符分割	速度快	不感知语义边界，可能切断句子
    MarkdownNodeParser	Markdown 文档	按标题结构切分	不支持 PDF 等非 MD 格式
    SentenceWindowNodeParser	检索时需要上下文	每个 chunk 带上下句窗口	内存占用大，适合高级 RAG
JS/TS 官方包还没有实现。
    按 AST 切代码：可以自己用 @babel/parser 或 acorn 解析 JS/TS 代码，按函数/类级别切分
    按语义切分：可以调用 Embedding API 计算句子间的余弦相似度，在相似度低的断点处分隔

问题🙋1: SentenceSplitter 会按页切分 一个完整内容在不同上下页的时候会被切开, 这样会影响到后续的rag
    对 RAG 的影响量表
    场景	影响	原因
    检索命中	中等 ↓	跨页段落只取半段，chunk 语义不完整，embedding 相似度降低
    LLM 推理	严重 ↓	LLM 只拿到半段内容，容易给出错误或不完整的回答
    表格/图表跨页	非常严重	表格被切开后完全不可用，embedding 和 LLM 都看不懂
解决方案
    方案 1：合并 PDF 全文后再切分 ✅ 推荐
    方案 2：利用 chunk_overlap 兜底
    方案 3：用 Semantic Splitter（如果有）
    方案 4：改用 AI Parser（如 LlamaCloud Parse）
按语义切分实现原理
    Python 的 SemanticSplitterNodeParser 核心逻辑是：
    1. SentenceSplitter 将文本切成句子
    2. 窗口滑动，每次取 K 句算一个 embedding
    3. 相邻窗口的 embedding 余弦相似度低于阈值 → 此处断开
*/
}

import { SentenceSplitter } from "@llamaindex/core/node-parser";
import SemanticSplitter from "../SemanticSplitter.ts";
import { Document } from "@llamaindex/core/schema";

// // 默认 chunkSize=1024, chunkOverlap=200
// const splitter = new SentenceSplitter({ chunkSize: 1024, chunkOverlap: 200 });
// // 对 Document 进行切分
// const nodes = splitter.getNodesFromDocuments(documents);
// console.log(nodes);

/**
 * 输出的是 12 个按页分开的 Document，即使语义切分生效，每个 Document 内部也切不动。
 */

// 1. 将所有页合并为一个完整的 Document
const fullText = documents.map((d: Document) => d.text).join("\n\n");
const mergedDoc = new Document({ text: fullText, id_: "merged-pdf" });

console.log(`📊 合并后总字符数: ${fullText.length}}`);

// 2. 语义切分
const semanticSplitter = new SemanticSplitter();
const nodes = await semanticSplitter.splitDocuments([mergedDoc]);

console.log(`\n✅ 切分为 ${nodes.length} 个 chunk`);
console.log(nodes);
// nodes.forEach((node, i) => {
//   console.log(`\n📄 Chunk ${i + 1}:`);
//   console.log(`  字符数: ${node.text.length}`);
//   console.log(`  前 100 字: ${node.text.slice(0, 100)}...`);
// });

import { VectorStoreIndex } from "llamaindex";
import { OpenAIEmbedding } from "@llamaindex/openai";
import { Settings } from "@llamaindex/core/global";
import llm from "../llm.ts";

Settings.embedModel = new OpenAIEmbedding({
  model: "text-embedding-v3", // 阿里云通义千问 embedding 模型
});

Settings.llm = llm;

const index = await VectorStoreIndex.init({ nodes });

/**
 * 简单总结
    结构	大白话
    docStore	📦 存原始文章内容的地方
    indexStore	🗂️ 记录有哪些索引
    indexStruct	📋 索引的目录结构（节点 ID 列表）
    vectorStores	🔢 存向量数字（相似度搜索用）
    embedModel	📐 把文字转成向量的模型
 */
console.log(`\n✅ 构建向量 ${index} `);

// 创建查询引擎
const queryEngine = index.asQueryEngine({
  similarityTopK: 3, // 检索最相似的 3 个 chunk
});

// 提问
const response = await queryEngine.query({
  query: "CoT是什么",
});

console.log("🤖 回答:", response.toString());

// 查看检索到了哪些 chunk
console.log("\n📎 参考来源:");
response.sourceNodes?.forEach((node, i) => {
  console.log(`  [${i + 1}] ${node.node.text.slice(0, 80)}...`);
});
