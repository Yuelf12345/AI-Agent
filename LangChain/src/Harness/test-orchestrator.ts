import { Orchestrator } from "./src/harness/agents/orchestrator.ts";

/**
 * Orchestrator测试脚本
 * 
 * 验证：Orchestrator能否正确分析并拆解任务
 */

async function testOrchestrator() {
  const orchestrator = new Orchestrator();

  console.log("=".repeat(60));
  console.log("Orchestrator 测试");
  console.log("=".repeat(60));

  const testCases = [
    {
      name: "简单任务",
      input: "你好，介绍一下你自己",
    },
    {
      name: "单工具任务",
      input: "读取package.json文件",
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
      const plan = await orchestrator.execute(testCase.input);
      
      console.log(`\n思考: ${plan.thinking}`);
      console.log(`需要拆解: ${plan.needSplit ? "是" : "否"}`);
      
      if (plan.needSplit) {
        console.log("\n子任务:");
        plan.subtasks.forEach((task, i) => {
          console.log(`  ${i + 1}. [${task.assignedTo}] ${task.description}`);
        });
      } else {
        console.log(`\n直接回复: ${plan.directResponse?.substring(0, 100)}...`);
      }
      
    } catch (error) {
      console.error(`错误: ${(error as Error).message}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("测试完成");
  console.log("=".repeat(60));
}

testOrchestrator().catch(console.error);
