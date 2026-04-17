/**
 * 
  检索器是一个接口，它根据非结构化查询返回文档。它不存储文档，只负责检索文档。检索器可以：
  包装矢量商店
  实现自定义搜索逻辑
  调用外部 API
  合并多个来源
  重新排序结果
 */

import { Chroma } from "@langchain/community/vectorstores/chroma";
import { OpenAIEmbeddings } from "@langchain/openai";
import { TavilySearchAPIRetriever } from "@langchain/community/retrievers/tavily_search_api";

import { BM25Retriever } from "@langchain/community/retrievers/bm25";
import { Document } from "@langchain/core/documents";

import { ChaindeskRetriever } from "@langchain/community/retrievers/chaindesk";

import { BaseRetriever } from "@langchain/core/retrievers";
import { CallbackManagerForRetrieverRun } from "@langchain/core/callbacks/manager";
// LCEL
import { model } from "./0.agent.ts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";


const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-v3", // 阿里云通义千问 embedding 模型
});
/**
 * 启动 ChromaDB 服务器：
 * # 使用 Docker
docker run -d -p 8000:8000 chromadb/chroma
# 或使用 pip 安装后运行
pip install chromadb
chroma run --host localhost --port 8000
 */
// const vectorStore = new Chroma(embeddings, {
//   // url: "http://localhost:8000",  // ChromaDB 地址
//   collectionName: "documents"
// });

// 1.将向量存储用作检索器
// const asRetriever = vectorStore.asRetriever({
//   k: 4,
//   searchType: "similarity", // or "mmr" for diversity
// });

// const docs1 = await asRetriever.invoke("LangChain是什么?");

// 2.使用外部搜索 API 的检索器
// const APIRetriever = new TavilySearchAPIRetriever({
//   apiKey: process.env.OPENAI_API_KEY,
//   k: 5,
//   includeRawContent: false,
//   includeImages: false,
//   searchDepth: "advanced", // "basic" or "advanced"
//   includeDomains: ["example.com"], // Optional
//   excludeDomains: ["spam.com"], // Optional
// });

// const docs2 = await APIRetriever.invoke("最新的AI新闻");


// 3.基于BM25算法的关键词检索。

// const docs3 = [
//   new Document({
//     pageContent: "LangChain is a framework for building LLM applications.",
//     metadata: { source: "docs" },
//   }),
//   new Document({
//     pageContent: "Vector stores enable semantic search over documents.",
//     metadata: { source: "docs" },
//   }),
// ];
// const BM25retriever = BM25Retriever.fromDocuments(docs3, {
//   k: 2,
// });

// const results = await BM25retriever.invoke("LLM 框架");

// 4. 链式 从 Chaindesk 知识库中检索。
// const chaindeskRetriever = new ChaindeskRetriever({
//   datastoreId: "your-datastore-id",
//   apiKey: process.env.CHAINDESK_API_KEY,
//   topK: 5,
// });
// const docs = await chaindeskRetriever.invoke("product documentation");

// 您可以通过扩展以下功能来创建自定义检索器BaseRetriever
// class CustomRetriever extends BaseRetriever {
//   lc_namespace = ["langchain", "retrievers", "custom"];
//   async _getRelevantDocuments(
//     query: string,
//     runManager?: CallbackManagerForRetrieverRun
//   ): Promise<Document[]> {
//     // Implement your retrieval logic
//     const results = await this.search(query);
    
//     return results.map(
//       (result) =>
//         new Document({
//           pageContent: result.content,
//           metadata: result.metadata,
//         })
//     );
//   }
//   async search(query: string) {
//     // Your custom search implementation
//     return [];
//   }
// }


// LCEL
const prompt = ChatPromptTemplate.fromTemplate(
  `Answer based on context:
  Context: {context}
  Question: {question}`
);

// ChromaDB 服务器未启动 该用测试方案
// const retriever = vectorStore.asRetriever();

import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import {docSplits} from "./3.RAG.ts";
const memoryVectorStore = await MemoryVectorStore.fromDocuments(docSplits, embeddings);
const memoryRetriever = memoryVectorStore.asRetriever();

const chain = prompt
  .pipe(model)
  .pipe(new StringOutputParser());

const result = await chain.invoke({
  context: await memoryRetriever.invoke("query"),
  question: "query",
});

console.log('result', result);
