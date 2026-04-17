import {
  StateGraph,
  StateSchema,
  START,
  MemorySaver,
  Command,
  interrupt,
  MessagesValue,
} from "@langchain/langgraph";
import { createAgent, tool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import * as z from "zod";
import * as dotenv from "dotenv";
dotenv.config();
const model = new ChatOpenAI({
  model: "qwen-plus",
  temperature: 0.5,
  maxTokens: 1000,
});

const sub = async () => {
  const SubgraphState = new StateSchema({
    foo: z.string(),
    bar: z.string(),
  });

  const subgraphBuilder = new StateGraph(SubgraphState)
    .addNode("subgraphNode1", (state) => {
      return { bar: "bar" };
    })
    .addNode("subgraphNode2", (state) => {
      return { foo: state.foo + state.bar };
    })
    .addEdge(START, "subgraphNode1")
    .addEdge("subgraphNode1", "subgraphNode2");

  const subgraph = subgraphBuilder.compile();

  const ParentState = new StateSchema({
    foo: z.string(),
  });

  const builder = new StateGraph(ParentState)
    .addNode("node1", (state) => {
      return { foo: "hi! " + state.foo };
    })
    .addNode("node2", subgraph)
    .addEdge(START, "node1")
    .addEdge("node1", "node2");

  const graph = builder.compile();

  for await (const chunk of await graph.stream({ foo: "foo" })) {
    console.log(chunk);
  }
};
// sub();

const fruitInfo = tool((input) => `Info about ${input.fruitName}`, {
  name: "fruit_info",
  description: "Look up fruit info.",
  schema: z.object({ fruitName: z.string() }),
});

const veggieInfo = tool((input) => `Info about ${input.veggieName}`, {
  name: "veggie_info",
  description: "Look up veggie info.",
  schema: z.object({ veggieName: z.string() }),
});

// subAgent
const fruitAgent = createAgent({
  model,
  tools: [fruitInfo],
  systemPrompt:
    "You are a fruit expert. Use the fruit_info tool. Respond in one sentence.",
});

const veggieAgent = createAgent({
  model,
  tools: [veggieInfo],
  systemPrompt:
    "You are a veggie expert. Use the veggie_info tool. Respond in one sentence.",
});

const askFruitExpert = tool(
  async (input) => {
    const response = await fruitAgent.invoke({
      messages: [{ role: "user", content: input.question }],
    });
    return response.messages[response.messages.length - 1].content;
  },
  {
    name: "ask_fruit_expert",
    description: "Ask the fruit expert. Use for ALL fruit questions.",
    schema: z.object({ question: z.string() }),
  },
);
const askVeggieExpert = tool(
  async (input) => {
    const response = await veggieAgent.invoke({
      messages: [{ role: "user", content: input.question }],
    });
    return response.messages[response.messages.length - 1].content;
  },
  {
    name: "ask_veggie_expert",
    description: "Ask the veggie expert. Use for ALL veggie questions.",
    schema: z.object({ question: z.string() }),
  },
);
const agent = createAgent({
  model,
  tools: [askFruitExpert, askVeggieExpert],
  systemPrompt:
    "You have two experts: ask_fruit_expert and ask_veggie_expert. " +
    "ALWAYS delegate questions to the appropriate expert.",
  checkpointer: new MemorySaver(),
});

const config = { configurable: { thread_id: "1" } };
const response = await agent.invoke(
  { messages: [{ role: "user", content: "Tell me about apples" }] },
  config,
);
// HumanMessage -> AIMessage -> ToolMessage -> AIMessage
console.log("response:", response);

const response1 = await agent.invoke(
  { messages: [{ role: "user", content: "Now tell me about bananas" }] },
  config,
);
console.log("response1:", response1);

function createSubAgent(
  model: string,
  { name, ...kwargs }: { name: string; [key: string]: any },
) {
  const agent = createAgent({ model, name, ...kwargs });
  return new StateGraph(new StateSchema({ messages: MessagesValue }))
    .addNode(name, agent)
    .addEdge(START, name)
    .compile();
}
