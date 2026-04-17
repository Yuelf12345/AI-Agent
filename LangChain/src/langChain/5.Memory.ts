// https://docs.langchain.com/oss/javascript/langgraph/add-memory
// https://reference.langchain.com/javascript/langchain-langgraph/web/InMemoryStore

import {
  MemorySaver,
  StateSchema,
  MessagesValue,
  StateGraph,
  GraphNode,
  START,
  END,
  REMOVE_ALL_MESSAGES,
  ReducedValue,
  InMemoryStore,
  Command,
} from "@langchain/langgraph";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import {
  createAgent,
  createMiddleware,
  summarizationMiddleware,
  tool,
  ToolMessage,
  type ToolRuntime,
} from "langchain";
import { model } from "./0.agent";
import { historyPrompt } from "./1.prompt";
import * as z from "zod";
import { RemoveMessage } from "@langchain/core/messages";

/**
 * 启用短期记忆后，长时间的对话可能会超出 LLM 的上下文窗口。常见的解决方案如下：
 */
// a. 修剪消息
const trimMessages = createMiddleware({
  name: "TrimMessages",
  beforeModel: (state) => {
    const messages = state.messages;
    if (messages.length <= 3) {
      return; // No changes needed
    }
    const firstMsg = messages[0];
    const recentMessages =
      messages.length % 2 === 0 ? messages.slice(-3) : messages.slice(-4);
    const newMessages = [firstMsg, ...recentMessages];
    return {
      messages: [
        new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
        ...newMessages,
      ],
    };
  },
});
// b.删除消息
const deleteOldMessages = createMiddleware({
  name: "DeleteOldMessages",
  afterModel: (state) => {
    const messages = state.messages;
    if (messages.length > 2) {
      // remove the earliest two messages
      return {
        messages: messages
          .slice(0, 2)
          .map((m) => new RemoveMessage({ id: m.id! })),
      };
    }
    return;
  },
});
// c.消息摘要
const summarizeMessages = summarizationMiddleware({
  model,
  trigger: { tokens: 4000 },
  keep: { messages: 20 },
});
// d.使用工具获取记忆 - StateSchema 使用示例
const CustomState = new StateSchema({
  messages: MessagesValue,
  userId: z.string().optional(),
  userName: z.string().optional(),
});
const getUserInfo = tool(
  async (_, config: ToolRuntime<typeof CustomState.State>) => {
    const userId = config.state.userId;
    return userId === "1" ? "张三" : "其他人";
  },
  {
    name: "get_user_info",
    description: "获取用户信息",
    schema: z.object({}),
  },
);
const updateUserInfo = tool(
  async (_, config: ToolRuntime<typeof CustomState.State>) => {
    const userId = config.state.userId;
    const name = userId === "1" ? "李四" : "其他人";
    return new Command({
      update: {
        userName: name,
        messages: [
          new ToolMessage({
            content: `已成功查找用户信息，用户名是: ${name}。现在可以调用 greet 工具来问候用户。`,
            tool_call_id: config.toolCall?.id ?? "",
          }),
        ],
      },
    });
  },
  {
    name: "update_user_info",
    description: "查找并更新用户信息。必须在 greet 工具之前调用。",
    schema: z.object({}),
  },
);
const greet = tool(
  async (_, config: ToolRuntime<typeof CustomState.State>) => {
    const userName = config.state.userName;
    if (!userName) {
      return "请先调用 update_user_info 工具获取用户信息，然后再问候用户。";
    }
    return `你好 ${userName}!`;
  },
  {
    name: "greet",
    description: "一旦你找到用户的信息，就用它来问候他们。",
    schema: z.object({}),
  },
);
const agent1 = createAgent({
  model,
  //   tools: [getUserInfo],
  tools: [updateUserInfo, greet],
  stateSchema: CustomState,
});
// const result = await agent1.invoke(
//   {
//     messages: [{ role: "user", content: "问候用户" }],
//     userId: "1"
//   },
// );
// console.log(result.messages.at(-1)?.content);

// 1. 短期记忆
const checkpointer = new MemorySaver();
// const agent = createAgent({
//   model,
//   checkpointer,
// });
// const response = await agent.invoke(
// // role "ai" | "human" | "tool" | "system" | (string & NonNullable<unknown>)
//   { messages: [{ role: "user", content: "hi! i am Bob" }] },
//   { configurable: { thread_id: "1" } },
// );
// console.log("response", response);

// 定义了 LangGraph 的状态结构
const State = new StateSchema({
  messages: MessagesValue,
});
const stateExtensionMiddleware = createMiddleware({
  name: "StateExtension",
  stateSchema: State,
});
const agent = createAgent({
  model,
  middleware: [trimMessages, stateExtensionMiddleware],
  checkpointer,
});

{
  // 对话历史
  // 测试短期记忆：需要 thread_id 来保存会话状态
  const threadId = "test-session-1";
  // 第一次对话
  const response1 = await agent.invoke(
    { messages: [{ role: "user", content: "我是你的主人越大大" }] },
    { configurable: { thread_id: threadId } },
  );
  console.log(
    "第一次回复:",
    response1.messages[response1.messages.length - 1].content,
  );
  // 第二次对话（同一个 thread_id，应该记住之前的内容）
  const response2 = await agent.invoke(
    { messages: [{ role: "user", content: "我是谁?" }] },
    { configurable: { thread_id: threadId } },
  );
  console.log(
    "第二次回复:",
    response2.messages[response2.messages.length - 1].content,
  );
}

// 带对话历史的链
const chatHistory = [
  new HumanMessage("我是张三"),
  new AIMessage("你好，张三！我能为你做些什么？"),
  new HumanMessage("LCEL是什么?"),
  new AIMessage(
    "LCEL是LangChain Expression Language，用于组合链式操作的声明式语言。",
  ),
];

{
  // 使用 historyPrompt 构建带历史的节点
  const historyNode: GraphNode<typeof State.State> = async (state) => {
    const chain = historyPrompt.pipe(model);
    const response = await chain.invoke({
      chat_history: state.messages,
      input: state.messages[state.messages.length - 1].content,
    });
    return { messages: [response] };
  };

  const historyGraph = new StateGraph(State)
    .addNode("history_node", historyNode)
    .addEdge(START, "history_node")
    .addEdge("history_node", END)
    .compile();

  // 测试带历史的对话
  const historyResult = await historyGraph.invoke({
    messages: [...chatHistory, new HumanMessage("我是谁？")],
  });
  console.log(
    "带历史回答:",
    historyResult.messages[historyResult.messages.length - 1].content,
  );
}

// // batch]delete\get\listNamespaces\put\serch\start\stop
// const history = new InMemoryStore();
// const userId = "user_ID";
// const applicationContext = "chitchat";
// const namespace = [userId, applicationContext];

// /**
//     namespace = 文件夹路径
//     key = 文件名
//     value = 文件内容
//  */
// // 插入几条数据
// await history.put(namespace, "msg-1", new HumanMessage("你好"));
// await history.put(namespace, "msg-2", new AIMessage("你好！有什么可以帮助你的吗？"));
// await history.put(namespace, "msg-3", new HumanMessage("介绍一下 LangChain"));

// // 查询数据
// const allMessages = await history.search(namespace);
// console.log("所有消息:", allMessages);

// // 获取单条数据
// const msg = await history.get(namespace, "msg-1");
// console.log("单条消息:", msg);
