/**
 * ReAct Agent 测试
 * 
 * 运行方式: deno run --allow-all src/harness/agents/test-react.ts
 */
import { ReActAgent } from "../src/harness/agents/reactAgent.ts";

async function testReActAgent() {
  console.log("=== ReAct Agent 测试 ===\n");

  // 创建 ReAct Agent 实例
  const agent = new ReActAgent({ maxIterations: 5 });

  // 测试用例
  const testCases = [
    {
      input: "请读取当前目录下的 package.json 文件内容",
      description: "测试读取文件工具"
    },
    {
      input: "你好，请介绍一下你自己",
      description: "测试简单问答（无需工具）"
    },
    {
      input: "列出当前目录的所有文件",
      description: "测试 bash 工具"
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n--- 测试: ${testCase.description} ---`);
    console.log(`输入: ${testCase.input}\n`);

    try {
      const result = await agent.execute(testCase.input);
      
      console.log("\n结果:");
      console.log(`- 迭代次数: ${result.iterations}`);
      console.log(`- 最终回复: ${result.finalResponse}`);
      console.log("- 执行历史:");
      
      result.history.forEach((item: any, index: number) => {
        console.log(`  [${index + 1}] Thought: ${item.thought}`);
        console.log(`       Action: ${item.action}`);
        if (item.actionParams) {
          console.log(`       Params: ${JSON.stringify(item.actionParams)}`);
        }
        if (item.observation) {
          const obs = item.observation.length > 100 
            ? item.observation.substring(0, 100) + "..." 
            : item.observation;
          console.log(`       Observation: ${obs}`);
        }
      });

    } catch (error) {
      console.error("执行错误:", error);
    }

    // 重置 agent 状态
    agent.reset();
  }
}

testReActAgent();