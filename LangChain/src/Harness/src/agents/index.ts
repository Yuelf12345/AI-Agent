import { createAgent } from "langchain";
import { HumanMessage } from "@langchain/core/messages";
import { toolRegistry } from "../harness/tools/registry.ts";
import { llmService } from "../services/llm.ts";
const agent = createAgent({
  model: llmService.getModel(),
  tools: toolRegistry.getAllTools(),
});
const response = await agent.invoke({
  messages: [new HumanMessage("查看当前目录")],
});
console.log(response);
