import {
  MemorySaver,
  InMemoryStore,
  StateGraph,
  Annotation,
  StateSchema,
  MessagesValue,
  GraphNode,
  START,
  ConditionalEdgeRouter,
  END,
} from "@langchain/langgraph";
import {
  trimMessages,
  RemoveMessage,
  SystemMessage,
  HumanMessage,
  BaseMessage,
  AIMessage
} from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import * as dotenv from "dotenv";
import { z } from "zod";
dotenv.config();
import { v4 as uuidv4 } from "uuid";
const model = new ChatOpenAI({
  model: "qwen-plus",
  temperature: 0.5,
  maxTokens: 1000,
});

/**
 * 使用数据库
 * 
    import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
    const DB_URI = "postgresql://postgres:postgres@localhost:5442/postgres?sslmode=disable";
    const checkpointer = PostgresSaver.fromConnString(DB_URI);
    const builder = new StateGraph(...);
    const graph = builder.compile({ checkpointer });
 */

/**
 * 短期记忆
 */
{
  const config = { configurable: { thread_id: "1" } };
  const checkpointer = new MemorySaver();
  const stateAn = Annotation.Root({
    name: Annotation<string>(),
    messages: Annotation<{ role: string; content: string }[]>(),
  });
  const builder = new StateGraph(stateAn);
  const graph = builder.compile({ checkpointer });
  const result = await graph.invoke(
    { messages: [{ role: "user", content: "hi! i am Bob" }] },
    config,
  );
  //   console.log(result);
}
/**
 * 长期记忆
 */
{
  const config = { configurable: { thread_id: "1" }, context: { userId: "1" } };
  const store = new InMemoryStore();
  const State = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: (left, right) => left.concat(right),
    }),
  });
  const callModel: any = async (state, runtime) => {
    const userId = runtime.context?.userId;
    const namespace = [userId, "memories"];
    const memories = await runtime.store?.search(namespace, {
      query: state.messages.at(-1)?.content,
      limit: 3,
    });
    const info = memories?.map((d) => d.value.data).join("\n") || "";
    await runtime.store?.put(namespace, uuidv4(), {
      data: "User prefers dark mode",
    });
  };
  const builder = new StateGraph(State)
    .addNode("call_model", callModel)
    .addEdge(START, "call_model");
  const graph = builder.compile({ store });
  const result = await graph.invoke(
    { messages: [{ role: "user", content: "hi" }] },
    config,
  );
  //   console.log(result);
}

// 消息处理

const trim = async () => {
  const State = new StateSchema({
    messages: MessagesValue,
  });
  const callModel: GraphNode<typeof State> = async (state) => {
    // 1.裁剪
    const messages = await trimMessages(state.messages, {
      strategy: "last",
      maxTokens: 128,
      startOn: "human",
      endOn: ["human", "tool"],
      tokenCounter: model,
    });
    const response = await model.invoke(messages);
    return { messages: [response] };
  };
  // 2. 删除
  const deleteMessages: GraphNode<typeof State> = (state) => {
    const messages = state.messages;
    if (messages.length > 2) {
      // remove the earliest two messages
      return {
        messages: messages
          .slice(0, 2)
          .map((m) => new RemoveMessage({ id: m.id })),
      };
    }
    return {};
  };
  const checkpointer = new MemorySaver();
  const builder = new StateGraph(State)
    .addNode("call_model", callModel)
    .addNode("delete_messages", deleteMessages)
    .addEdge(START, "call_model")
    .addEdge("call_model", "delete_messages");

  const graph = builder.compile({ checkpointer });
  const config = { configurable: { thread_id: "1" } };
  await graph.invoke(
    { messages: [{ role: "user", content: "hi, my name is bob" }] },
    config,
  );
  await graph.invoke(
    { messages: [{ role: "user", content: "write a short poem about cats" }] },
    config,
  );
  await graph.invoke(
    { messages: [{ role: "user", content: "now do the same but for dogs" }] },
    config,
  );
  const finalResponse = await graph.invoke(
    { messages: [{ role: "user", content: "what's my name?" }] },
    config,
  );
  console.log(finalResponse.messages.at(-1)?.content);

  //   for await (const event of await graph.stream(
  //     { messages: [{ role: "user", content: "hi! I'm bob" }] },
  //     { ...config, streamMode: "values" },
  //   )) {
  //     console.log(
  //       event.messages.map((message) => [message.getType(), message.content]),
  //     );
  //   }

  //   for await (const event of await graph.stream(
  //     { messages: [{ role: "user", content: "what's my name?" }] },
  //     { ...config, streamMode: "values" },
  //   )) {
  //     console.log(
  //       event.messages.map((message) => [message.getType(), message.content]),
  //     );
  //   }
};
// trim();

const summary = async () => {
  const memory = new MemorySaver();
  //   const GraphState = Annotation.Root({
  //     messages: Annotation<any[]>({
  //       reducer: (left, right) => left.concat(right),
  //       default: () => [],
  //     }),
  //     summary: Annotation<string>({
  //       reducer: (left, right) => left.concat(right),
  //       default: () => "",
  //     }),
  //   });
  const GraphState = new StateSchema({
    messages: MessagesValue,
    summary: z.string().default(""),
  });

  const callModel: GraphNode<typeof GraphState> = async (state) => {
    const { summary } = state;
    let { messages } = state;
    if (summary) {
      const systemMessage = new SystemMessage({
        id: uuidv4(),
        content: `前面的对话摘要：${summary}`,
      });
      messages = [systemMessage, ...messages];
    }
    const response = await model.invoke(messages);
    return { messages: [response] };
  };

  // 逻辑
  const shouldContinue: ConditionalEdgeRouter<typeof GraphState> = (state) => {
    const messages = state.messages;
    if (messages.length > 6) {
      return "summarize_conversation";
    }
    return END;
  };

  const summarizeConversation: GraphNode<typeof GraphState> = async (state) => {
    const { summary, messages } = state;
    let summaryMessage: string;
    if (summary) {
      summaryMessage =
        `这是迄今为止的对话摘要：${summary}\n\n` +
        "考虑到上述新信息，扩展摘要：";
    } else {
      summaryMessage = "创建上述对话的摘要：";
    }
    const allMessages = [
      ...messages,
      new HumanMessage({ id: uuidv4(), content: summaryMessage }),
    ];
    const response = await model.invoke(allMessages);
    const deleteMessages = messages
      .slice(0, -2)
      .map((m) => new RemoveMessage({ id: m.id! }));

    if (typeof response.content !== "string") {
      throw new Error("Expected a string response from the model");
    }
    return { summary: response.content, messages: deleteMessages };
  };

  const workflow = new StateGraph(GraphState)
    .addNode("conversation", callModel)
    .addNode("summarize_conversation", summarizeConversation)
    .addEdge(START, "conversation")
    .addConditionalEdges("conversation", shouldContinue)
    .addEdge("summarize_conversation", END);
  const app = workflow.compile({ checkpointer: memory });
  const config = { configurable: { thread_id: "1" } };
  const response = await app.invoke(
    {
      messages: [
        { role: "user", content: "hi, my name is bob" },
        { role: "assistant", content: "hello bob, how can I help you?" },
        { role: "user", content: "I'm writing a paper about cats" },
        {
          role: "assistant",
          content: "that sounds interesting, what kind of paper?",
        },
        { role: "user", content: "I'm writing about the history of cats" },
        {
          role: "assistant",
          content: "that's a great topic, what have you found so far?",
        },
        {
          role: "user",
          content: "I've found that cats have been around for a long time",
        },
        {
          role: "assistant",
          content: "yes, they have been around for over 9,000 years",
        },
        { role: "user", content: "that's amazing, I didn't know that" },
        { role: "assistant", content: "yes, they're very old animals" },
      ],
    },
    config,
  );
  console.log("response:", response);
};
// summary();