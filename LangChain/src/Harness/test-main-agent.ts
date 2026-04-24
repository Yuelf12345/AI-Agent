import { MainAgent } from "./src/harness/agents/mainAgent.ts";

/**
 * MainAgent测试脚本
 * 
 * 验证：新的MainAgent能否正确分析和编排任务
 */

async function testMainAgent() {
  const agent = new MainAgent();

  console.log("=".repeat(60));
  console.log("MainAgent 测试（新架构）");
  console.log("=".repeat(60));

  const testCases = [
    {
      name: "简单问答",
      input: "你好，介绍一下你自己",
    },
    {
      name: "单步任务（文件）",
      input: "读取当前目录的package.json文件",
    },
    {
      name: "需要拆解的任务",
      input: "帮我整理上周的会议笔记，并从中提取待办事项",
    },
    {
      name: "搜索+总结任务",
      input: "搜索关于RAG的笔记，并写一个总结",
    },
  ];

  for (const testCase of testCases) {
    console.log("\n" + "-".repeat(60));
    console.log(`测试: ${testCase.name}`);
    console.log(`输入: ${testCase.input}`);
    console.log("-".repeat(60));

    try {
      const startTime = Date.now();
      const result = await agent.execute(testCase.input);
      const duration = Date.now() - startTime;

      console.log(`\n类型: ${result.type}`);
      console.log(`思考: ${result.thinking}`);
      console.log(`耗时: ${duration}ms`);

      if (result.type === "orchestrated") {
        console.log(`\n子任务:`);
        result.subtasks.forEach((task: any, i: number) => {
          console.log(`  ${i + 1}. [${task.assignedTo}] ${task.description} - ${task.status}`);
        });
        console.log(`\n执行结果:`);
        result.results.forEach((r: string, i: number) => {
          console.log(`  ${i + 1}. ${r}`);
        });
      } else {
        console.log(`\n回复: ${result.response?.substring(0, 200)}...`);
      }

    } catch (error) {
      console.error(`错误: ${(error as Error).message}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("测试完成");
  console.log("=".repeat(60));
  console.log("\n架构对比:");
  console.log("旧架构: Router → Planner → Supervisor → Workers (多次LLM调用)");
  console.log("新架构: MainAgent直接分析并执行 (单次LLM调用)");
}

testMainAgent().catch(console.error);
