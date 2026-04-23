// LangGraph 构建 Retrieval (RAG) 链
// https://langchain-ai.github.io/langgraphjs/tutorials/rag/

import { StateSchema, MessagesValue, StateGraph, START, END } from "@langchain/langgraph";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Document } from "@langchain/core/documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { model } from "./0.agent.ts";
import * as z from "zod";

// 1. 定义状态 Schema
const RAGState = new StateSchema({
  messages: MessagesValue,        // 对话历史
  question: z.string(),           // 用户问题
  context: z.array(z.any()).optional(),  // 检索到的文档
  answer: z.string().optional(),  // 最终回答
});

// 2. 准备示例文档（实际项目中从文件或数据库加载）
const sampleDocs = [
  new Document({ pageContent: "LCEL（LangChain Expression Language）是一种声明式语言，用于轻松组合链式操作。", metadata: { source: "doc1" } }),
  new Document({ pageContent: "LangGraph 是用于构建有状态、多角色应用程序的库，基于图结构定义工作流。", metadata: { source: "doc2" } }),
  new Document({ pageContent: "RAG（检索增强生成）结合了检索系统和生成模型，先用检索器找相关文档，再用 LLM 生成回答。", metadata: { source: "doc3" } }),
  new Document({ pageContent: "向量数据库用于存储文档的嵌入向量，支持相似性搜索。常用有 FAISS、Chroma、Pinecone 等。", metadata: { source: "doc4" } }),
];

// 3. 创建向量存储和检索器
const embeddings = new OpenAIEmbeddings();
const vectorStore = await MemoryVectorStore.fromDocuments(sampleDocs, embeddings);
const retriever = vectorStore.asRetriever({ k: 2 });

// 4. 定义检索节点
async function retrieve(state: typeof RAGState.State) {
  const question = state.question;
  const docs = await retriever.invoke(question);
  return { context: docs };
}

// 5. 定义生成回答节点
async function generate(state: typeof RAGState.State) {
  const docsText = state.context?.map((d: Document) => d.pageContent).join("\n\n") || "";
  const question = state.question;
  
  const prompt = ChatPromptTemplate.fromTemplate(`你是问答助手。使用以下检索到的上下文回答问题。

上下文:
{context}

问题: {question}

回答:`);
  
  const chain = prompt.pipe(model);
  const response = await chain.invoke({ context: docsText, question });
  
  return { answer: response.content };
}

// 6. 构建 LangGraph
const ragGraph = new StateGraph(RAGState)
  .addNode("retrieve", retrieve)
  .addNode("generate", generate)
  .addEdge(START, "retrieve")
  .addEdge("retrieve", "generate")
  .addEdge("generate", END);

const ragChain = ragGraph.compile();

// 7. 测试 RAG 链
console.log("=== 测试 LangGraph RAG 链 ===\n");

const result1 = await ragChain.invoke({ question: "什么是 LCEL？" });
console.log("问题: 什么是 LCEL？");
console.log("回答:", result1.answer);
console.log("检索到的文档:", result1.context?.map((d: Document) => d.pageContent.slice(0, 50) + "..."));

console.log("\n---\n");

const result2 = await ragChain.invoke({ question: "RAG 是什么？" });
console.log("问题: RAG 是什么？");
console.log("回答:", result2.answer);

// 8. 带对话历史的 RAG（多轮对话）
console.log("\n\n=== 带对话历史的 RAG 链 ===\n");

const conversationalRAGState = new StateSchema({
  messages: MessagesValue,
  context: z.array(z.any()).optional(),
});

async function retrieveWithHistory(state: typeof conversationalRAGState.State) {
  const lastMessage = state.messages[state.messages.length - 1];
  const question = typeof lastMessage.content === "string" ? lastMessage.content : "";
  const docs = await retriever.invoke(question);
  return { context: docs };
}

async function generateWithHistory(state: typeof conversationalRAGState.State) {
  const docsText = state.context?.map((d: Document) => d.pageContent).join("\n\n") || "";
  const lastMessage = state.messages[state.messages.length - 1];
  const question = typeof lastMessage.content === "string" ? lastMessage.content : "";
  
  const systemPrompt = `你是问答助手。使用检索到的上下文和对话历史回答问题。

上下文:
${docsText}

请根据上下文和之前的对话，简洁地回答用户的问题。`;

  const response = await model.invoke([
    new HumanMessage(systemPrompt),
    ...state.messages.slice(0, -1),
    new HumanMessage(question),
  ]);
  
  return { messages: [response] };
}

const conversationalRAGGraph = new StateGraph(conversationalRAGState)
  .addNode("retrieve", retrieveWithHistory)
  .addNode("generate", generateWithHistory)
  .addEdge(START, "retrieve")
  .addEdge("retrieve", "generate")
  .addEdge("generate", END);

const conversationalRAGChain = conversationalRAGGraph.compile();

// 测试多轮对话
const response1 = await conversationalRAGChain.invoke({
  messages: [new HumanMessage("LangGraph 是什么？")],
});
console.log("用户: LangGraph 是什么？");
console.log("助手:", (response1.messages[response1.messages.length - 1] as AIMessage).content);

console.log("\n---\n");

const response2 = await conversationalRAGChain.invoke({
  messages: [
    new HumanMessage("LangGraph 是什么？"),
    response1.messages[response1.messages.length - 1],
    new HumanMessage("它有什么优势？"),
  ],
});
console.log("用户: 它有什么优势？");
console.log("助手:", (response2.messages[response2.messages.length - 1] as AIMessage).content);
