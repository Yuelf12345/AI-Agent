import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import {
  createAgent,
  tool,
  createMiddleware,
  ToolMessage,
  dynamicSystemPromptMiddleware,
} from "langchain";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import * as z from "zod";

export const model = new ChatOpenAI({
  model: "qwen-plus",
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_API_BASE_URL,
  },
  temperature: 0.5,
  maxTokens: 1000,
  //  streaming: false, // 禁用流输出
});
const model1 = new ChatOpenAI({
  model: "qwen-plus",
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_API_BASE_URL,
  },
  temperature: 0.7,
  maxTokens: 2000,
});

// 工具
const search = tool(({ query }) => `Results for: ${query}`, {
  name: "search",
  description: "Search for information",
  schema: z.object({
    query: z.string().describe("The query to search for"),
  }),
});
const getWeather = tool((input) => `It's always sunny in ${input.city}!`, {
  name: "get_weather",
  description: "Get the weather for a given city",
  schema: z.object({
    city: z.string().describe("The city to get the weather for"),
  }),
});
// 工具错误处理
const toolNode = new ToolNode([search, getWeather], { handleToolErrors: true });

// 1. 动态选择模型
const dynamicModelSelection = createMiddleware({
  name: "DynamicModelSelection",
  wrapModelCall: (request, handler) => {
    const messageCount = request.messages.length;

    return handler({
      ...request,
      model: messageCount > 10 ? model1 : model,
    });
  },
});

// 2. 动态prompt
const contextSchema = z.object({
  userRole: z.enum(["expert", "beginner"]),
});
const dynamicSystemPrompt = dynamicSystemPromptMiddleware<
  z.infer<typeof contextSchema>
>((state, runtime) => {
  const userRole = runtime.context.userRole || "user";
  const basePrompt = "你是个乐于助人的助手。";
  if (userRole === "expert") {
    return `${basePrompt} 提供详细的技术回复。`;
  } else if (userRole === "beginner") {
    return `${basePrompt} 简单地解释概念，避免行话。`;
  }
  return basePrompt;
});

// 3. 动态选择tool
const stateBasedTools = createMiddleware({
  name: "StateBasedTools",
  wrapModelCall: (request, handler) => {
    const state = request.state as typeof request.state & {
      authenticated?: boolean;
    };
    const isAuthenticated = state.authenticated ?? false;
    const messageCount = state.messages.length;
    let filteredTools = request.tools;
    if (!isAuthenticated) {
      filteredTools = request.tools.filter(
        (t: any) => typeof t.name === "string" && t.name.startsWith("get_"),
      );
    } else if (messageCount < 5) {
      filteredTools = request.tools.filter(
        (t: any) => typeof t.name === "string" && t.name !== "search",
      );
    }
    return handler({ ...request, tools: filteredTools });
  },
});

// 4. 错误处理
const handleToolErrors = createMiddleware({
  name: "HandleToolErrors",
  wrapToolCall: async (request, handler) => {
    try {
      return await handler(request);
    } catch (error) {
      // Return a custom error message to the model
      return new ToolMessage({
        content: `Tool error: Please check your input and try again. (${error})`,
        tool_call_id: request.toolCall.id!,
      });
    }
  },
});

const agent = createAgent({
  model, // Base model (used when messageCount ≤ 10)
  tools: [getWeather],
  // responseFormat: z.object({
  //   punny_response: z.string(),
  //   weather_conditions: z.string().optional(),
  // }),
  middleware: [
    dynamicModelSelection,
    dynamicSystemPrompt,
    stateBasedTools,
    handleToolErrors,
  ],
});

// 流传输 - 方式1: values 模式（打印完整状态）
async function streamWithValues() {
  console.log("\n=== Stream Mode: values ===\n");
  const stream = await agent.stream(
    {
      messages: [{ role: "user", content: "什么是LCEL" }],
    },
    {
      streamMode: "values",
      context: { userRole: "beginner" },
    },
  );

  for await (const chunk of stream) {
    const lastMessage = chunk.messages[chunk.messages.length - 1];
    console.log(`[${lastMessage._getType()}]: ${lastMessage.content}`);
  }
}

// 流传输 - 方式2: updates 模式（打印每步更新）
async function streamWithUpdates() {
  console.log("\n=== Stream Mode: updates ===\n");
  const stream = await agent.stream(
    {
      messages: [{ role: "user", content: "简单介绍一下LangChain" }],
    },
    {
      streamMode: "updates",
      context: { userRole: "beginner" },
    },
  );

  for await (const chunk of stream) {
    const [step, content] = Object.entries(chunk)[0];
    console.log(`\n--- Step: ${step} ---`);
    if (content?.messages?.length) {
      const msg = content.messages[content.messages.length - 1];
      console.log(`[${msg._getType()}]: ${msg.content}`);
    } else {
      console.log(JSON.stringify(content, null, 2));
    }
  }
}

// 流传输 - 方式3: messages 模式（打印 token 流）
async function streamWithMessages() {
  console.log("\n=== Stream Mode: messages ===\n");
  const stream = await agent.stream(
    {
      messages: [{ role: "user", content: "简单介绍一下LangChain" }],
    },
    {
      streamMode: "messages",
      context: { userRole: "beginner" },
    },
  );

  process.stdout.write("[ai]: ");
  for await (const chunk of stream) {
    if (Array.isArray(chunk)) {
      for (const msg of chunk) {
        if (msg.content && typeof msg.content === "string") {
          process.stdout.write(msg.content);
        }
      }
    }
  }
  console.log("\n");
}

// 执行流打印
// await streamWithValues();
// await streamWithUpdates();
// await streamWithMessages();

export default agent;


export const useAgent = (config: Record<string, boolean>) => {
  return createAgent({
    model, // Base model (used when messageCount ≤ 10)
    tools: [getWeather],
    // responseFormat: z.object({
    //   punny_response: z.string(),
    //   weather_conditions: z.string().optional(),
    // }),
    middleware: [
      dynamicModelSelection,
      dynamicSystemPrompt,
      stateBasedTools,
      handleToolErrors,
    ],
    ...config,
  });
};