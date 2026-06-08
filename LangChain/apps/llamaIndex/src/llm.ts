import { OpenAI } from "@llamaindex/openai";

const configs = {
  local: {
    model: process.env.LOCAL_MODEL || "qwen2.5:7b",   // 通义千问本地模型
    apiKey: process.env.LOCAL_API_KEY,
    baseURL: process.env.LOCAL_BASE_URL,
  },
  default: {
    model: process.env.OPENAI_MODEL || "qwen-plus",   // 通义大语言本地模型
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  },
  vision: {
    model: "qwen-vl-plus",  // 通义千问视觉模型
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  }
} as const;

const key = (process.env.LOCAL || "default") as keyof typeof configs;
const llm = new OpenAI(configs[key]);

export default llm;


