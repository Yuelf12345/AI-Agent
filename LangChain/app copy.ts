// import llm from "./utils/llm";

// const response = await llm.invoke("你是谁");
// console.log(response.content);


import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { createAgent, tool,  type ToolRuntime, initChatModel } from "langchain";
import * as z from "zod";

const llm = new ChatOpenAI({ 
 model: "qwen-plus",
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: 
      process.env.OPENAI_API_BASE_URL,
  },
  temperature: 0.7,
  maxTokens: 1000,
 });


 const model = await initChatModel(
  "qwen-plus",
  { 
    temperature: 0.5, 
    timeout: 10, 
    maxTokens: 1000,
    modelProvider: "openai" // 需要显式指定 modelProvider 参数
  }
);


const getWeather = tool(
  (input) => `${input.city}的天气总是阳光明媚!`,
  {
    name: "get_weather",
    description: "获取指定城市的天气情况",
    schema: z.object({
      city: z.string().describe("获取天气的城市"),
    }),
  }
);

type AgentRuntime = ToolRuntime<unknown, { user_id: string }>;

const getUserLocation = tool(
  (_, config: AgentRuntime) => {
    const { user_id } = config.context;
    return user_id === "1" ? "beijing" : "shanghai";
  },
  {
    name: "get_user_location",
    description: "根据用户ID检索用户信息",
  }
);

// const ContactInfo = z.object({
//   message: z.string(),
// });

// 
const responseFormat = z.object({
  punny_response: z.string(),
  weather_conditions: z.string().optional(),
});

const agent = createAgent({
  model: llm,   
  tools: [getWeather, getUserLocation],
  responseFormat
});


const systemPrompt = "你是一个天气预报员"

const config = {
  configurable: { thread_id: "1" },
  context: { user_id: "1" },
};



const response = await agent.invoke({
    messages: [{ role: "user", content: "武汉的天气怎么样" }],
  },config)

console.log("response",response.structuredResponse);
