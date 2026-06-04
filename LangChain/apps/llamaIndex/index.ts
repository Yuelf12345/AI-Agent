import LlamaCloud from "@llamaindex/llama-cloud";
import fs from "fs";
import { z } from "zod";
import llm from "./llm.ts";

const ResumeSchema = z.object({
  input: z.string().describe("输入的问题"),
});

const client = new LlamaCloud({
  apiKey: process.env.LLAMAINDEX_API_KEY,
});

const pdf = async () => {
  const file = await client.files.create({
    file: fs.createReadStream("./files/prompt.pdf"),
    purpose: "parse",
  });

  /** 解析
   * tier:  层级 分别在成本、延迟和准确性之间进行权衡。
      fast— 基于规则、成本最低、无需人工智能
      cost_effective— 速度与质量兼顾
      agentic— 完全由人工智能驱动的解析
      agentic_plus— 具备专业功能的高级人工智能
  * 
  */
  const result = await client.parsing.parse({
    file_id: file.id,
    tier: "cost_effective",
    version: "latest",
    expand: ["markdown"],
  });
  console.log(result.markdown?.pages);
};
// pdf()


const response = await llm.chat({
  messages: [{ role: "user", content: "你好！请介绍一下你自己" }],
});
console.log("🤖", response.message.content);
