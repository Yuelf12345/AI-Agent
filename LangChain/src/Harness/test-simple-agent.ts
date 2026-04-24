import { SimpleAgent } from "./src/harness/agents/simpleAgent.ts";

/**
 * SimpleAgent测试脚本
 * 
 * 目的：验证单次LLM调用能解决多少问题
 * 按照Claude建议，先验证再决定是否需要复杂架构
 */

async function testSimpleAgent() {
  const agent = new SimpleAgent();

  console.log("=".repeat(60));
  console.log("SimpleAgent 测试开始");
  console.log("=".repeat(60));

  // 测试用例列表
  const testCases = [
    {
      name: "简单问答",
      input: "你好，介绍一下你自己",
      expectTool: false,
    },
    {
      name: "读取文件（需要工具）",
      input: "读取当前目录的package.json文件",
      expectTool: true,
      toolName: "file_read",
    },
    {
      name: "写入文件（需要工具）",
      input: "创建一个test.txt文件，内容是Hello World",
      expectTool: true,
      toolName: "file_write",
    },
    {
      name: "复杂问题（多步骤）",
      input: "帮我整理会议笔记并提取待办事项",
      expectTool: false, // SimpleAgent可能无法处理
    },
  ];

  const results = [];

  for (const testCase of testCases) {
    console.log("\n" + "-".repeat(60));
    console.log(`测试: ${testCase.name}`);
    console.log(`输入: ${testCase.input}`);
    console.log("-".repeat(60));

    try {
      const startTime = Date.now();
      const result = await agent.execute(testCase.input);
      const duration = Date.now() - startTime;

      console.log(`结果类型: ${result.type}`);
      console.log(`耗时: ${duration}ms`);
      
      if (result.type === "tool_call") {
        console.log(`工具名称: ${result.toolName}`);
        console.log(`工具结果: ${result.toolResult?.substring(0, 100)}...`);
      } else {
        console.log(`回复: ${result.response?.substring(0, 200)}...`);
      }

      results.push({
        name: testCase.name,
        success: true,
        type: result.type,
        duration,
        usedTool: result.type === "tool_call",
        expectedTool: testCase.expectTool,
        match: result.type === "tool_call" === testCase.expectTool,
      });

    } catch (error) {
      console.error(`错误: ${(error as Error).message}`);
      results.push({
        name: testCase.name,
        success: false,
        error: (error as Error).message,
      });
    }
  }

  // 打印测试报告
  console.log("\n" + "=".repeat(60));
  console.log("测试报告");
  console.log("=".repeat(60));

  console.table(results);

  const successCount = results.filter((r) => r.success).length;
  const toolCallCount = results.filter((r) => r.usedTool).length;
  const matchCount = results.filter((r) => r.match !== false).length;

  console.log(`\n成功率: ${successCount}/${results.length}`);
  console.log(`工具调用次数: ${toolCallCount}`);
  console.log(`预期匹配率: ${matchCount}/${results.length}`);

  console.log("\n结论:");
  console.log("1. 如果成功率 > 80%: SimpleAgent足够，不需要复杂架构");
  console.log("2. 如果成功率 < 80%: 分析失败案例，考虑添加Prompt Chaining");
  console.log("3. 如果多步骤任务失败: 考虑添加Orchestrator");
}

// 运行测试
testSimpleAgent().catch(console.error);
