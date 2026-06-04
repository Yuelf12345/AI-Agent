import { OpenAI } from "@llamaindex/openai";

const configs = {
  local: {
    model: process.env.LOCAL_MODEL || "qwen2.5:7b",
    apiKey: process.env.LOCAL_API_KEY,
    baseURL: process.env.LOCAL_BASE_URL,
  },
  default: {
    model: process.env.OPENAI_MODEL || "qwen-plus",
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  },
} as const;

const key = (process.env.LOCAL || "default") as keyof typeof configs;
const llm = new OpenAI(configs[key]);

export default llm;