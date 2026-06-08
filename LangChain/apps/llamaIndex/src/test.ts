import llm from "./llm.ts";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const imgPath = path.resolve(__dirname, "../files/harness.png");
const imgBuffer = fs.readFileSync(imgPath);
const base64 = imgBuffer.toString("base64");
const dataUrl = `data:image/png;base64,${base64}`;

// 发送图片让 LLM 识别
const response = await llm.chat({
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "请描述这张图片的内容" },
        { type: "image_url", image_url: {url: dataUrl} },
      ],
    },
  ],
});

console.log(response);
