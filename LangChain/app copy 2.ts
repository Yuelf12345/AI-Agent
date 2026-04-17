import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import * as dotenv from "dotenv";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import {
  StringOutputParser,
  CommaSeparatedListOutputParser,
} from "@langchain/core/output_parsers";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";

import { Document } from "@langchain/core/documents";
import "cheerio";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { createRetrieverTool } from "@langchain/classic/tools/retriever";

// const model = new ChatOpenAI({
//   model:"qwen-plus",
//   apiKey: process.env.OPENAI_API_KEY,
//   configuration:{
//     baseURL: process.env.OPENAI_API_BASE_URL
//   },
//   temperature: 0.7,
//   maxTokens: 1000,
// })

// 使用环境变量
dotenv.config();
const model = new ChatOpenAI({
  model: "qwen-plus",
  temperature: 0.7,
  maxTokens: 1000,
  verbose: true,
});

/**
 * 一、模型创建
 */

// 1.单个调用
// const response = await model.invoke('你是谁?')

// 2.批量调用
// const response = await model.batch(['你是谁?','你会什么?'])
// console.log(response);

// 3. 流调用
// const response = await model.stream("你是谁?")
// for await (const chunk of response){
//   console.log(chunk.content);

// }

/**
 * 二、模版
 */

// const prompt = ChatPromptTemplate.fromTemplate('讲一个关于 {input} 的笑话')
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "根据用户输入想一个笑话"],
  ["user", "{input}"],
]);
// const response = await  prompt.format({input:'狗'})
// console.log(response);
// const chain = prompt.pipe(model).pipe(outputParser)
// const response = await chain.invoke({
//   input:'狗'
// })
// console.log(response);

/**
 * 三、输出解析器
 */

// 1. 普通解析器
// const outputParser = new StringOutputParser()
// const chain = prompt.pipe(model).pipe(outputParser)
// const response = await chain.invoke({
//   input:'狗'
// })
// console.log(response);

// 2.数组解析器 CommaSeparatedListOutputParser
async function callListOutputParser() {
  const prompt = ChatPromptTemplate.fromTemplate(`
    将一个关于 {input} 的笑话
    `);
  const outputParser = new CommaSeparatedListOutputParser();
  const chain = prompt.pipe(model).pipe(outputParser);
  return await chain.invoke({
    input: "狗",
  });
}
// const response = await callListOutputParser()
// console.log(response);

// 3. 结构解析器
async function callStructuredParser() {
  const prompt = ChatPromptTemplate.fromTemplate(`
    随机生成个人信息,至少包括:
    姓名:{name},
    年龄:{age}
    `);
  const outputParser = StructuredOutputParser.fromNamesAndDescriptions({
    name: "这个人的名字",
    age: "这个人的年龄",
  });
  const chain = prompt.pipe(model).pipe(outputParser);
  return await chain.invoke({
    name: "张三",
    age: 18,
  });
}
// const response = await callStructuredParser()
// console.log(response, typeof response);

// 4. zod解析器 - 使用 withStructuredOutput (推荐方法)
async function callZodOutputParser() {
  const schema = z.object({
    name: z.string().describe("水果名称"),
    type: z.array(z.string()).describe("水果特征,至少包含3个特征"),
  });

  const modelWithStructuredOutput = model.withStructuredOutput(schema);

  const prompt = ChatPromptTemplate.fromTemplate(`
    请生成一个水果的信息，包括名称和特征（颜色、口感、营养等）。
    
    示例水果：{name}
    `);

  const chain = prompt.pipe(modelWithStructuredOutput);
  return await chain.invoke({
    name: "苹果",
  });
}

// 5. 使用 StructuredOutputParser 的正确方法（替代方案）
async function callStructuredOutputParserWithInstructions() {
  const schema = z.object({
    name: z.string().describe("水果名称"),
    type: z.array(z.string()).describe("水果特征"),
  });
  const outputParser = StructuredOutputParser.fromZodSchema(schema);
  const formatInstructions = outputParser.getFormatInstructions();
  const prompt = ChatPromptTemplate.fromTemplate(`
    请生成一个水果的信息，包括名称和特征（颜色、口感、营养等）。
    示例水果：{name}
    {format_instructions}
    `);

  const chain = prompt.pipe(model).pipe(outputParser);
  return await chain.invoke({
    name: "香蕉",
    format_instructions: formatInstructions,
  });
}

// const response = await callZodOutputParser()
// console.log('方案1 - withStructuredOutput:', response, typeof response);

// const response2 = await callStructuredOutputParserWithInstructions()
// console.log('方案2 - StructuredOutputParser:', response2, typeof response2);

/**
 * 四.RAG
 */
const prompt2 = ChatPromptTemplate.fromTemplate(`
    回答用户的问题.
    内容: {content}
    问题: {input}
  `);
console.log("==========文档处理==========");
// 1. documents
const documents1 = new Document({
  pageContent:
    "LCEL是一直金毛巡回犬的名字",
});
// const chain = prompt2.pipe(model)
// const res = await chain.invoke({
//   content: documents2.pageContent,
//   input:' 什么是LCEL?',
// })
// console.log(res);
// 2. 网页文档
const pTagSelector = "p";
const loader = new CheerioWebBaseLoader(
  "https://docs.langchain.com/oss/javascript/integrations/document_loaders/web_loaders/web_cheerio",
  {
    selector: pTagSelector, // 提取p标签内容
  },
);
const docs = await loader.load();
const documents2 = docs[0];
// console.log("documents2:", documents2.pageContent);
// 3. 文本分隔
const docsList = docs.flat();
const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 500,
  chunkOverlap: 50,
});
const docSplits = await textSplitter.splitDocuments(docsList);
console.log("docSplits:", docSplits);
console.log("==========创建检索工具==========");
// 4. 向量存储 使用内存向量存储和 OpenAI 嵌入：
const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-v3", // 阿里云通义千问 embedding 模型
});
const vectorStore = await MemoryVectorStore.fromDocuments(
  // [documents2],
  docSplits,
  embeddings,
);
// 5.检索器
const retriever = vectorStore.asRetriever({
  k: 2, // 检索时返回的最相似文档片段 1、2-5、10+
});
const relevantDocs = await retriever.invoke("什么是LCEL?");
console.log("relevantDocs", relevantDocs);

// 使用 LangChain 的预构建功能创建检索工具createRetrieverTool：
const tool = createRetrieverTool(
  retriever,
  {
    name: "retrieve_blog_posts",
    description:
      "搜索并返回关于博客中关于大型语言模型代理、提示工程以及大型语言模型对抗性攻击的文章信息。",
  },
);
const tools = [tool];
