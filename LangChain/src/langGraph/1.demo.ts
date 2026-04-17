/**
 * 
  Command 是什么
  Command 是 LangGraph 中用于控制图执行流程的特殊对象。
  主要用途
  用法	作用
  new Command({ resume: value })	从 interrupt() 恢复执行，传递用户输入
  new Command({ goto: "nodeName" })	跳转到指定节点
  new Command({ update: {...} })	更新状态后继续执行
 */

import {
  StateSchema, // 定义状态
  StateGraph, // 定义图
  START,
  END,
  GraphNode, // 定义节点
  Command,  // 定义命令
  interrupt, // 中断函数
  MemorySaver, // 记忆缓存
} from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import * as z from "zod";
import * as dotenv from "dotenv";
dotenv.config();

const EmailClassificationSchema = z.object({
  intent: z.enum(["question", "bug", "billing", "feature", "complex"]),
  urgency: z.enum(["low", "medium", "high", "critical"]),
  topic: z.string(),
  summary: z.string(),
});
// 1.定义状态：
const EmailAgentState = new StateSchema({
  emailContent: z.string(),
  senderEmail: z.string(),
  emailId: z.string(),
  classification: EmailClassificationSchema.optional(),
  searchResults: z.array(z.string()).optional(),
  customerHistory: z.record(z.string(), z.any()).optional(),
  responseText: z.string().optional(),
});

type EmailClassificationType = z.infer<typeof EmailClassificationSchema>;

const llm = new ChatOpenAI({
  model: "qwen-plus",
  temperature: 0.5,
  maxTokens: 1000,
});

// 2.定义节点

// 读取分类
const readEmail: GraphNode<typeof EmailAgentState> = async (state, config) => {
  console.log(`Processing email: ${state.emailContent}`);
  return {};
};
const classifyIntent: GraphNode<typeof EmailAgentState> = async (
  state,
  config,
) => {
  // 利用大语言模型对邮件意图和紧急程度进行分类，然后按分类结果路由处理
  // 创建返回EmailClassification对象的结构化大型语言模型
  const structuredLlm = llm.withStructuredOutput(EmailClassificationSchema);

  // 格式prompt
  const classificationPrompt = `
    分析这封客户邮件并进行分类：

    邮件内容：${state.emailContent}
    发件人：${state.senderEmail}

    提供分类，包括意图、紧急程度、主题及摘要。
  `;

  // 直接作为对象获取结构化响应
  const classification = await structuredLlm.invoke(classificationPrompt);

  // 根据分类确定下一个节点
  let nextNode:
    | "searchDocumentation"
    | "humanReview"
    | "draftResponse"
    | "bugTracking";

  if (
    classification.intent === "billing" ||
    classification.urgency === "critical"
  ) {
    nextNode = "humanReview";
  } else if (
    classification.intent === "question" ||
    classification.intent === "feature"
  ) {
    nextNode = "searchDocumentation";
  } else if (classification.intent === "bug") {
    nextNode = "bugTracking";
  } else {
    nextNode = "draftResponse";
  }

  // 将分类存储为状态中的单个对象
  return new Command({
    update: { classification },
    goto: nextNode,
  });
};

// 搜索和跟踪节点
const searchDocumentation: GraphNode<typeof EmailAgentState> = async (
  state,
  config,
) => {
  // 搜索知识库获取相关信息
  // 根据分类构建搜索查询
  const classification = state.classification!;
  const query = `${classification.intent} ${classification.topic}`;

  let searchResults: string[];

  try {
    // 在此实现你的搜索逻辑
    // 存储原始搜索结果，而非格式化文本
    searchResults = [
      "通过设置>安全>更改密码重置密码",
      "密码必须至少包含12个字符",
      "包括大写、小写、数字和符号",
    ];
  } catch (error) {
    // 对于可恢复的搜索错误，存储错误并继续
    searchResults = [`Search temporarily unavailable: ${error}`];
  }
  return new Command({
    update: { searchResults }, // 存储原始结果或错误
    goto: "draftResponse",
  });
};

const bugTracking: GraphNode<typeof EmailAgentState> = async (
  state,
  config,
) => {
  // 创建或更新 Bug 跟踪工单

  // 在你的 Bug 跟踪系统中创建工单
  const ticketId = "BUG-12345"; // 应通过 API 创建

  return new Command({
    update: { searchResults: [`已创建 Bug 工单 ${ticketId}`] },
    goto: "draftResponse",
  });
};

// 响应节点
const draftResponse: GraphNode<typeof EmailAgentState> = async (
  state,
  config,
) => {
  // 使用上下文生成响应，并根据质量进行路由

  const classification = state.classification!;

  // 按需从原始状态数据格式化上下文
  const contextSections: string[] = [];

  if (state.searchResults) {
    // 为提示格式化搜索结果
    const formattedDocs = state.searchResults
      .map((doc) => `- ${doc}`)
      .join("\n");
    contextSections.push(`相关文档:\n${formattedDocs}`);
  }

  if (state.customerHistory) {
    // 为提示格式化客户数据
    contextSections.push(
      `客户等级: ${state.customerHistory.tier ?? "standard"}`,
    );
  }

  // 使用格式化的上下文构建提示
  const draftPrompt = `
    起草一封回复给客户的邮件:
    ${state.emailContent}

    邮件意图: ${classification.intent}
    紧急程度: ${classification.urgency}

    ${contextSections.join("\n\n")}

    指导原则:
    - 保持专业和乐于助人
    - 针对他们的具体问题进行回复
    - 在相关时使用提供的文档
  `;

  const response = await llm.invoke([new HumanMessage(draftPrompt)]);

  // 根据紧急程度和意图判断是否需要人工审核
  const needsReview =
    classification.urgency === "high" ||
    classification.urgency === "critical" ||
    classification.intent === "complex";

  // 路由到合适的下一个节点
  const nextNode = needsReview ? "humanReview" : "sendReply";

  return new Command({
    update: { responseText: response.content.toString() }, // 仅存储原始响应
    goto: nextNode,
  });
};

const humanReview: GraphNode<typeof EmailAgentState> = async (
  state,
  config,
) => {
  // 使用 interrupt 暂停等待人工审核，并根据决策路由
  const classification = state.classification!;

  // interrupt() 必须放在最前面 - 它之前的任何代码在恢复时都会重新执行
  const humanDecision = interrupt({
    emailId: state.emailId,
    originalEmail: state.emailContent,
    draftResponse: state.responseText,
    urgency: classification.urgency,
    intent: classification.intent,
    action: "请审核并批准/编辑此响应",
  });

  // 现在处理人工决策
  if (humanDecision.approved) {
    return new Command({
      update: {
        responseText: humanDecision.editedResponse || state.responseText,
      },
      goto: "sendReply",
    });
  } else {
    // 拒绝意味着人工将直接处理
    return new Command({ update: {}, goto: END });
  }
};

const sendReply: GraphNode<typeof EmailAgentState> = async (state, config) => {
  // 发送邮件回复
  // 集成邮件服务
  console.log(`发送回复: ${state.responseText!.substring(0, 100)}...`);
  return {};
};

// 3.连接

const workflow = new StateGraph(EmailAgentState)
  .addNode("readEmail", readEmail)
  .addNode("classifyIntent", classifyIntent, {
    ends: [
      "searchDocumentation",
      "humanReview",
      "draftResponse",
      "bugTracking",
    ],
  })
  .addNode("searchDocumentation", searchDocumentation, {
    ends: ["draftResponse"],
  })
  .addNode("bugTracking", bugTracking, {
    ends: ["draftResponse"],
  })
  .addNode("draftResponse", draftResponse, {
    ends: ["humanReview", "sendReply"],
  })
  .addNode("humanReview", humanReview, {
    ends: ["sendReply", END],
  })
  .addNode("sendReply", sendReply)
  .addEdge(START, "readEmail")
  .addEdge("readEmail", "classifyIntent")
  .addEdge("sendReply", END);

const memory = new MemorySaver();
const app = workflow.compile({ checkpointer: memory });

type EmailAgentStateType = {
  emailContent: string;
  senderEmail: string;
  emailId: string;
};
// 4.测试
const initialState: EmailAgentStateType = {
  emailContent: "I was charged twice for my subscription! This is urgent!",
  senderEmail: "customer@example.com",
  emailId: "email_123",
};

const config = { configurable: { thread_id: "customer_123" } };
const result = await app.invoke(initialState, config);

console.log(
  `Draft ready for review: ${result.responseText?.substring(0, 100)}...`,
);

const humanResponse = new Command({
  resume: {
    approved: true,
    editedResponse:
      "We sincerely apologize for the double charge. I've initiated an immediate refund...",
  },
}) as any;
const finalResult = await app.invoke(humanResponse, config);
console.log("Email sent successfully!", finalResult);
const finalResult1 = {
  emailContent: "I was charged twice for my subscription! This is urgent!",
  senderEmail: "customer@example.com",
  emailId: "email_123",
  classification: {
    intent: "complex",
    urgency: "high",
    topic: "billing_error",
    summary:
      "客户报告同一订阅被重复扣款，认为存在计费错误，要求立即核查与纠正。",
  },
  searchResults: undefined,
  customerHistory: undefined,
  responseText:
    "We sincerely apologize for the double charge. I've initiated an immediate refund...",
};
