import { OpenAIEmbedding } from "@llamaindex/openai";
import { Settings } from "@llamaindex/core/global";

// ─── Embedding 配置 ───────────────────────────────────────────────────
const configs = {
  local: {
    model: process.env.LOCAL_EMBED_MODEL || "bge-m3",
    apiKey: process.env.LOCAL_API_KEY || "ollama",
    baseURL: process.env.LOCAL_BASE_URL || "http://localhost:11434/v1",
  },
  default: {
    model: process.env.EMBED_MODEL || "text-embedding-v3",  // 阿里云通义千问 embedding
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  },
} as const;

const key = (process.env.LOCAL || "default") as keyof typeof configs;
const embeddingModel = new OpenAIEmbedding(configs[key]);

// ─── 自动配置全局 Settings ────────────────────────────────────────────
Settings.embedModel = embeddingModel;
console.log(`⚙️  Embedding 已配置 — ${configs[key].model} (${key === "local" ? "本地 Ollama" : "云端阿里云"})`);

export default embeddingModel;
export { configs };