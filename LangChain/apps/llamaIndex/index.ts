import LlamaCloud from "@llamaindex/llama-cloud";
import fs from "fs";

const client = new LlamaCloud({
  apiKey: process.env.LLAMAINDEX_API_KEY, // llx-2YTdXrixa9w74hQ7NeGPoJiSmifmY11DlGB12VB3QJK0y06Z
});

const file = await client.files.create({
  file: fs.createReadStream("./files/prompt.pdf"),
  purpose: "parse",
});
const result = await client.parsing.parse({
  file_id: file.id,
  tier: "agentic",
  version: "latest",
  expand: ["markdown"],
});

console.log(result.markdown?.pages);
