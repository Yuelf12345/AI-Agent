import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  ReducedValue,
  GraphNode,
  ConditionalEdgeRouter,
  START,
  END,
} from "@langchain/langgraph";
import {
  SystemMessage,
  AIMessage,
  ToolMessage,
  HumanMessage
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import * as z from "zod";
import * as dotenv from "dotenv"
dotenv.config()

// const model = new ChatAnthropic({
//   model: "qwen3.6-plus",
//   temperature: 0,
//   maxTokens: undefined,
//   maxRetries: 2,
// });

const model = new ChatOpenAI({
  model: "qwen-plus",
  temperature: 0.5,
  maxTokens: 1000,
});

// 1.工具
const add = tool(({ a, b }) => a + b, {
  name: "add",
  description: "加两个数",
  schema: z.object({
    a: z.number().describe("第一个数字"),
    b: z.number().describe("第二个数字"),
  }),
});
const multiply = tool(({ a, b }) => a * b, {
  name: "multiply",
  description: "乘两个数",
  schema: z.object({
    a: z.number().describe("第一个数字"),
    b: z.number().describe("第二个数字"),
  }),
});
const divide = tool(({ a, b }) => a / b, {
  name: "divide",
  description: "除两个数",
  schema: z.object({
    a: z.number().describe("第一个数字"),
    b: z.number().describe("第二个数字"),
  }),
});
// tools
const toolsByName = {
  [add.name]: add,
  [multiply.name]: multiply,
  [divide.name]: divide,
};
const tools = Object.values(toolsByName);
const modelWithTools = model.bindTools(tools);

// 2.状态
const MessagesState = new StateSchema({
  messages: MessagesValue,
  llmCalls: new ReducedValue(z.number().default(0), {
    reducer: (x, y) => x + y,
  }),
});

// 3.记录
const llmCall: GraphNode<typeof MessagesState> = async (state) => {
  return {
    messages: [
      await modelWithTools.invoke([
        new SystemMessage(
          "你是一个有用的助手，请根据用户的问题，使用工具来解决问题。",
        ),
        ...state.messages,
      ]),
    ],
    llmCalls: 1,
  };
};

// 4.工具节点
const toolNode: GraphNode<typeof MessagesState> = async (state) => {
  const lastMessage = state.messages.at(-1);
  if (lastMessage == null || !AIMessage.isInstance(lastMessage)) {
    return { messages: [] };
  }
  const result: ToolMessage[] = [];
  for (const toolCall of lastMessage.tool_calls ?? []) {
    const tool = toolsByName[toolCall.name];
    const observation = await tool.invoke(toolCall);
    result.push(observation);
  }

  return { messages: result };
};

// 5.逻辑
const shouldContinue: ConditionalEdgeRouter<typeof MessagesState> = (state) => {
//   console.log("state", state);
  const lastMessage = state.messages.at(-1);
  if (!lastMessage || !AIMessage.isInstance(lastMessage)) {
    return END;
  }
  if (lastMessage.tool_calls?.length) {
    return "toolNode";
  }
  return END;
};

// 6. 构建图
/*
 * ┌─────────────────────────────────────────────────────────┐
 * │                    ReAct Agent 流程图                     │
 * ├─────────────────────────────────────────────────────────┤
 * │                                                         │
 * │     START                                               │
 *        │                                                  │
 *        ▼                                                  │
 *   ┌─────────┐                                             │
 *   │ llmCall │◄──────────────────┐                         │
 *   └────┬────┘                   │                         │
 *        │                        │                         │
 *        ▼                        │                         │
 *   ┌─────────────┐               │                         │
 *   │shouldContinue│             │                         │
 *   └──────┬──────┘               │                         │
 *          │                      │                         │
 *     ┌────┴────┐                 │                         │
 *     │         │                 │                         │
 *     ▼         ▼                 │                         │
 *  [无工具]   [有工具]             │                         │
 *     │         │                 │                         │
 *     ▼         ▼                 │                         │
 *   END    ┌─────────┐            │                         │
 *          │toolNode │────────────┘                         │
 *          └─────────┘                                      │
 *                                                         │
 * │ 每轮循环: LLM决策 → 执行工具 → 结果反馈 → LLM继续决策      │
 * └─────────────────────────────────────────────────────────┘
 */
const agent = new StateGraph(MessagesState)
  .addNode("llmCall", llmCall)
  .addNode("toolNode", toolNode)
  .addEdge(START, "llmCall")
  .addConditionalEdges("llmCall", shouldContinue, ["toolNode", END])
  .addEdge("toolNode", "llmCall")
  .compile();

// Invoke
const response = await agent.invoke({
  messages: [new HumanMessage("3 + 4")],
});

for (const message of response.messages) {
  console.log(`[${message.type}]: ${message.text}`);
}