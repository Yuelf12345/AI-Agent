import { ChatOpenAI } from "@langchain/openai";
import { tool } from "langchain";
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  BaseMessage,
} from "@langchain/core/messages";
import * as dotenv from "dotenv";
dotenv.config();
import { execSync } from "child_process";

function runBash(command: string): string {
  try {
    return execSync(command, { encoding: "utf-8" });
  } catch (error) {
    return `Error: ${error}`;
  }
}

const llm = new ChatOpenAI({
  model: "qwen-plus",
  temperature: 0.5,
  maxTokens: 1000,
});

// 查询天气tool
function getWeather(city: string): string {
  // 模拟天气查询
  const weatherData: Record<string, string> = {
    "北京": "晴天，15°C",
    "上海": "多云，18°C",
    "广州": "小雨，22°C",
    "深圳": "晴天，25°C",
  };
  return weatherData[city] || `${city}：暂无天气数据`;
}

const weatherTool = tool(getWeather, {
  name: "get_weather",
  description: "查询指定城市的天气信息",
  schema: {
    type: "object",
    properties: { city: { type: "string", description: "城市名称" } },
    required: ["city"],
  },
});

const bashTool = tool(runBash, {
  name: "bash",
  description: "Run a shell command.",
  schema: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
});

const llmWithTools = llm.bindTools([bashTool, weatherTool]);

// 代理循环
const agentLoop = async (messages: BaseMessage[]) => {
  while (true) {
    const response = await llmWithTools.invoke(messages);
    console.log('response',response);
    messages.push(new AIMessage({ content: response.content }));

    if (response.response_metadata?.finish_reason !== "tool_calls") {
      return;
    }

    const results =
      response.tool_calls?.map((toolCall) => {
        let output: string;
        if (toolCall.name === "bash") {
          output = runBash(toolCall.args.command as string);
        //   console.log(`\x1b[33m$ ${toolCall.args.command}\x1b[0m`);
        } else if (toolCall.name === "get_weather") {
          output = getWeather(toolCall.args.city as string);
        //   console.log(`\x1b[33m天气查询: ${toolCall.args.city}\x1b[0m`);
        } else {
          output = `未知工具: ${toolCall.name}`;
        }
        // console.log('output', output.slice(0, 200));
        return new ToolMessage({
          tool_call_id: toolCall.id!,
          content: output,
        });
      }) || [];

    messages.push(...results);
  }
};

// REPL 主循环
import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
};

const main = async () => {
  const history: BaseMessage[] = [];

  while (true) {
    try {
      const query = await question("\x1b[36ms01 >> \x1b[0m");
      const cmd = query.trim().toLowerCase();
      if (cmd === "q" || cmd === "exit" || cmd === "") {
        break;
      }
      history.push(new HumanMessage({ content: query }));
      await agentLoop(history);

      const responseContent = history[history.length - 1]?.content;
      if (typeof responseContent === "string") {
        // console.log(responseContent);
      }
    } catch (error) {
      break;
    }
  }

  rl.close();
};
main();

/**
 * 用户的问题内容 - 如果问天气，模型会选择 get_weather；
 * 如果问系统操作,如:列出当前目录文件，会选择 bash
 */