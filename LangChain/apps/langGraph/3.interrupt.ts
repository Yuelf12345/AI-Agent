import {
  Annotation,
  Command,
  END,
  INTERRUPT,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
  isInterrupted,
  StateSchema,
  MessagesValue,
  GraphNode,
} from "@langchain/langgraph";
import { tool } from "langchain";
import z from "zod";
import { ChatOpenAI } from "@langchain/openai";
import * as dotenv from "dotenv";
dotenv.config();
import * as readline from "readline";

// 1.暂停使用
async function approvalNode(state: any) {
  const approved = interrupt("您是否批准此操作？");
  return { approved };
}

// 2.恢复中断
// const config = { configurable: { thread_id: "thread-1" } };
// const result = await graph.invoke({ input: "data" }, config);
// console.log(result.__interrupt__);
// await graph.invoke(new Command({ resume: true }), config);

// 3.处理多个中断
const A = async () => {
  const State = Annotation.Root({
    vals: Annotation<string[]>({
      reducer: (left, right) =>
        left.concat(Array.isArray(right) ? right : [right]),
      default: () => [],
    }),
  });
  function nodeA(_state: typeof State.State) {
    const answer = interrupt("question_a") as string;
    return { vals: [`a:${answer}`] };
  }
  function nodeB(_state: typeof State.State) {
    const answer = interrupt("question_b") as string;
    return { vals: [`b:${answer}`] };
  }
  const graph = new StateGraph(State)
    .addNode("a", nodeA)
    .addNode("b", nodeB)
    .addEdge(START, "a")
    .addEdge(START, "b")
    .addEdge("a", END)
    .addEdge("b", END)
    .compile({ checkpointer: new MemorySaver() });
  const config = { configurable: { thread_id: "1" } };
  async function main() {
    // Step 1: invoke - both parallel nodes hit interrupt() and pause
    const interruptedResult = await graph.invoke({ vals: [] }, config);
    console.log("interruptedResult:", interruptedResult);
    /*
  {
    vals: [],
    __interrupt__: [
      { id: '...', value: 'question_a' },
      { id: '...', value: 'question_b' }
    ]
  }
  */

    // Step 2: resume all pending interrupts at once
    const resumeMap: Record<string, string> = {};
    if (isInterrupted(interruptedResult)) {
      for (const i of interruptedResult[INTERRUPT]) {
        if (i.id != null) {
          resumeMap[i.id] = `answer for ${i.value}`;
        }
      }
    }
    const result = await graph.invoke(
      new Command({ resume: resumeMap }),
      config,
    );

    console.log("Final state:", result);
    //> Final state: { vals: ['a:answer for question_a', 'b:answer for question_b'] }
  }
  main().catch(console.error);
};

// 3.批准或拒绝
const B = async () => {
  const State = new StateSchema({
    actionDetails: z.string(),
    status: z.enum(["pending", "approved", "rejected"]).nullable(),
  });
  const graphBuilder = new StateGraph(State)
    .addNode(
      "approval",
      async (state) => {
        // 公开细节，以便调用者可以在UI中呈现它们
        const decision = interrupt({
          question: "Approve this action?",
          details: state.actionDetails,
        });
        return new Command({ goto: decision ? "proceed" : "cancel" });
      },
      { ends: ["proceed", "cancel"] },
    )
    .addNode("proceed", () => ({ status: "approved" }))
    .addNode("cancel", () => ({ status: "rejected" }))
    .addEdge(START, "approval")
    .addEdge("proceed", END)
    .addEdge("cancel", END);

  const checkpointer = new MemorySaver();
  const graph = graphBuilder.compile({ checkpointer });

  const config = { configurable: { thread_id: "approval-123" } };
  const initial: any = await graph.invoke(
    { actionDetails: "Transfer $500", status: "pending" },
    config,
  );

  console.log("initial:", initial.__interrupt__);
  // [{ value: { question: ..., details: ... } }]

  // Resume with the decision; true routes to proceed, false to cancel
  const resumed = await graph.invoke(new Command({ resume: true }), config);
  console.log("status", resumed.status); // -> "approved"
};

// 4.审查和编辑状态
const C = async () => {
  const State = new StateSchema({
    generatedText: z.string(),
  });

  const builder = new StateGraph(State)
    .addNode("review", async (state) => {
      // Ask a reviewer to edit the generated content
      const updated = interrupt({
        instruction: "Review and edit this content",
        content: state.generatedText,
      });
      return { generatedText: updated };
    })
    .addEdge(START, "review")
    .addEdge("review", END);

  const checkpointer = new MemorySaver();
  const graph = builder.compile({ checkpointer });

  const config = { configurable: { thread_id: "review-42" } };
  const initial = await graph.invoke(
    { generatedText: "Initial draft" },
    config,
  );
  console.log("initial", initial.__interrupt__);
  // [{ value: { instruction: ..., content: ... } }]

  const finalState = await graph.invoke(
    new Command({ resume: "Improved draft after review" }),
    config,
  );
  console.log("generatedText", finalState.generatedText); // -> "Improved draft after review"
};
// C()

// 5.工具中断
const D = async () => {
  const sendEmailTool = tool(
    async ({ to, subject, body }) => {
      const response = interrupt({
        action: "send_email",
        to,
        subject,
        body,
        message: "Approve sending this email?",
      });
      if (response?.action === "approve") {
        const finalTo = response.to ?? to;
        const finalSubject = response.subject ?? subject;
        const finalBody = response.body ?? body;
        console.log("[sendEmailTool]", finalTo, finalSubject, finalBody);
        return `Email sent to ${finalTo}`;
      }
      return "Email cancelled by user";
    },
    {
      name: "send_email",
      description: "Send an email to a recipient",
      schema: z.object({
        to: z.string(),
        subject: z.string(),
        body: z.string(),
      }),
    },
  );

  const model = new ChatOpenAI({
    model: "qwen-plus",
    temperature: 0.5,
    maxTokens: 1000,
  }).bindTools([sendEmailTool]);

  const State = new StateSchema({
    messages: MessagesValue,
  });

  const agent: typeof State.Node = async (state) => {
    const response = await model.invoke(state.messages);
    return { messages: [response] };
  };

  const graphBuilder = new StateGraph(State)
    .addNode("agent", agent)
    .addEdge(START, "agent")
    .addEdge("agent", END);

  const checkpointer = new MemorySaver();
  const graph = graphBuilder.compile({ checkpointer });

  const config = { configurable: { thread_id: "email-workflow" } };
  const initial = await graph.invoke(
    {
      messages: [
        {
          role: "user",
          content: "Send an email to alice@example.com about the meeting",
        },
      ],
    },
    config,
  );
  console.log("initial", initial); // -> [{ value: { action: 'send_email', ... } }]

  // Resume with approval and optionally edited arguments
  const resumed = await graph.invoke(
    new Command({
      resume: { action: "approve", subject: "Updated subject" },
    }),
    config,
  );
  console.log(resumed.messages.at(-1)); // -> Tool result returned by send_email
};
// D();

// 6.验证人工输入
const E = async () => {
  const State = new StateSchema({
    age: z.number().nullable(),
  });

  const builder = new StateGraph(State)
    .addNode("collectAge", (state) => {
      let prompt = "What is your age?";
      while (true) {
        const answer = interrupt(prompt); // payload surfaces in result.__interrupt__
        if (typeof answer === "number" && answer > 0) {
          return { age: answer };
        }
        prompt = `'${answer}' is not a valid age. Please enter a positive number.`;
      }
    })
    .addEdge(START, "collectAge")
    .addEdge("collectAge", END);

  const checkpointer = new MemorySaver();
  const graph = builder.compile({ checkpointer });

  const config = { configurable: { thread_id: "form-1" } };
  const first = await graph.invoke({ age: null }, config);
  console.log("first:", first.__interrupt__); // -> [{ value: "What is your age?", ... }]

  // Provide invalid data; the node re-prompts
  const retry = await graph.invoke(new Command({ resume: "thirty" }), config);
  console.log("retry:", retry.__interrupt__); // -> [{ value: "'thirty' is not a valid age...", ... }]

  // Provide valid data; loop exits and state updates
  const final = await graph.invoke(new Command({ resume: 30 }), config);
  console.log("age:", final.age); // -> 30
};
// E();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const promptUser = (question: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
};
const demo = async () => {
  const State = new StateSchema({
    age: z.number().nullable(),
  });

  const builder = new StateGraph(State)
    .addNode("collectAge", (state) => {
      let prompt = "What is your age?";
      while (true) {
        const answer = interrupt(prompt);
        if (typeof answer === "number" && answer > 0) {
          return { age: answer };
        }
        prompt = `'${answer}' is not a valid age. Please enter a positive number.`;
      }
    })
    .addEdge(START, "collectAge")
    .addEdge("collectAge", END);

  const checkpointer = new MemorySaver();
  const graph = builder.compile({ checkpointer });

  const config = { configurable: { thread_id: "form-1" } };
  let result = await graph.invoke({ age: null }, config);

  // 交互式循环：AI 问 -> 用户输入 -> AI 再问
  while (isInterrupted(result)) {
    const prompt = result.__interrupt__?.[0]?.value as string;
    console.log("\nAI:", prompt);

    const input = await promptUser("You: ");
    const numInput = Number(input);
    const resumeValue = isNaN(numInput) ? input : numInput;

    result = await graph.invoke(
      new Command({ resume: resumeValue }) as any,
      config,
    );
  }

  console.log("\nFinal result:", result);
  rl.close();
};
demo();
