// https://docs.langchain.com/oss/javascript/langchain/rag#expand-for-full-code-snippet
import {model} from './0.agent'
import { prompt } from './1.prompt'
// 加载
import { Document } from "@langchain/core/documents";
import "cheerio";
import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
// 分割
import { CharacterTextSplitter, RecursiveCharacterTextSplitter, MarkdownTextSplitter } from "@langchain/textsplitters";
// Vector Stores 向量存储允许您存储和搜索嵌入向量。它们对于语义搜索、检索增强生成 (RAG) 以及其他需要查找相似文档的应用至关重要。
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
// FAISS Facebook AI 相似性搜索 - 高效的相似性搜索库。
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { OpenAIEmbeddings } from "@langchain/openai";

/**
 * 文档加载器 https://mintlify.wiki/langchain-ai/langchainjs/api/community/document-loaders
 * CSVLoader CSV 加载器
 * PDFLoader PDF 加载器
 * DocxLoader DOCX 加载器
 * CheerioWebBaseLoader Web 加载器
 */

// 1.生成文档
// const documents1 = new Document({
//   pageContent:
//     "LCEL是一直金毛巡回犬的名字",
// });
// const chain = prompt.pipe(model)
// const res = await chain.invoke({
//   content: documents1.pageContent,
//   input:' 什么是LCEL?',
// })
// console.log(res);

// 2.加载线上文档
const cheerioLoader = new CheerioWebBaseLoader(
  "https://lilianweng.github.io/posts/2023-06-23-agent/",
  {
    selector: "p", // 提取p标签内容
  },
);
const docs = await cheerioLoader.load();
// console.assert(docs.length === 1);
// console.log(`Total characters: ${docs[0].pageContent.length}`);
// console.log(docs[0].pageContent.slice(0, 500));

// 3.拆分文档: https://mintlify.wiki/langchain-ai/langchainjs/api/utilities/text-splitters#recursivecharactertextsplitter

/**
 * 
文本分割器（基类）
特性：
  separator（字符串）：要分割的字符串（默认值"\n\n"：）
  chunkSize: number- 每个数据块的最大大小
  chunkOverlap: number- 重叠字符数
  keepSeparator: boolean- 是否在输出中保留分隔符
  lengthFunction: (text: string) => number | Promise<number>- 用于测量文本长度的功能
方法：
  splitText(text: string): Promise<string[]>将文本分割成多个部分
  splitDocuments(documents: Document[], options?: ChunkHeaderOptions): Promise<Document[]>- 拆分文档
  createDocuments(texts: string[], metadatas?: Record<string, any>[], options?: ChunkHeaderOptions): Promise<Document[]>- 从文本创建文档
  transformDocuments(documents: Document[], options?: ChunkHeaderOptions): Promise<Document[]>- 转换文档（splitDocuments 的别名）
 */

// a.CharacterTextSplitter: 字符文本分割器
const longText= docs[0].pageContent;
const textSplitter = new CharacterTextSplitter({
  separator: "\n\n",
  chunkSize: 1000,
  chunkOverlap: 200,
});
const chunks = await textSplitter.splitText(longText);

// b.RecursiveCharacterTextSplitter: 递归字符文本分割器

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000, // 大小
  chunkOverlap: 200, // 
});
const splitDocs = await splitter.splitDocuments(docs);

const docsList = docs.flat();
export const docSplits = await textSplitter.splitDocuments(docsList);
// console.log("docSplits:", docSplits);

// c.MarkdownTextSplitter: md文档分割
const mdSplitter = new MarkdownTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});
// const mdChunks = await splitter.splitText(markdownText);


/**
 * RAG管道模式
 * 1. Split documents
 * 2. Create embeddings and store
 * 3. Use for retrieval
 */
const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-v3", // 阿里云通义千问 embedding 模型
});

// const vectorStore = await MemoryVectorStore.fromDocuments(
//   docSplits,
//   embeddings
// );

const vectorStore = await FaissStore.fromDocuments(
  docs,
  embeddings
);

await vectorStore.save("faiss_index");

const loadedStore = await FaissStore.load(
  "faiss_index",
  embeddings
);
const results = await loadedStore.similaritySearch("query", 4);
console.log('results', results);

// const query = "什么是LCEL?"
// const response = await vectorStore.similaritySearch(query);
// console.log('response:', response);


