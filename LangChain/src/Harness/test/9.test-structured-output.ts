/**
 * 测试 - 结构化输出 (Structured Output)
 *
 * 测试 Schema 定义、结构化解析器和正则降级解析器：
 * 1. Zod Schema 验证（正常输入）
 * 2. Zod Schema 验证（缺失字段、类型错误）
 * 3. StructuredOutputParser 解析
 * 4. RegexFallbackParser 降级解析
 * 5. 统一解析入口 parseAgentOutput
 * 6. JSON Schema 生成（用于 OpenAI response_format）
 */

import {
  SimpleAgentSchema,
  ReActAgentSchema,
  MainAgentSchema,
  SubTaskSchema,
  type SimpleAgentOutput,
  type ReActAgentOutput,
  type MainAgentOutput,
  getSimpleAgentJsonSchema,
  getReActAgentJsonSchema,
  getMainAgentJsonSchema,
  parseSimpleAgentOutput,
  parseReActAgentOutput,
  parseMainAgentOutput,
} from "../src/harness/output/schemas.ts";
import {
  StructuredOutputParser,
  RegexFallbackParser,
  parseAgentOutput,
} from "../src/harness/output/parser.ts";

// ==================== 测试 1：Zod Schema 正常验证 ====================

async function testSchemaValidation() {
  console.log("\n=== 测试 1：Zod Schema 正常验证 ===");

  // SimpleAgent
  const simpleInput = {
    thinking: "用户想读取文件",
    needTool: true,
    toolName: "read_file",
    toolParams: { filePath: "test.txt" },
    response: "正在读取文件",
  };
  const simpleResult = parseSimpleAgentOutput(simpleInput);
  console.log("SimpleAgent 验证通过:", simpleResult.thinking);
  console.assert(simpleResult.needTool === true, "needTool 应为 true");
  console.assert(simpleResult.toolName === "read_file", "toolName 应为 read_file");

  // ReActAgent
  const reactInput = {
    thought: "需要搜索笔记",
    action: "search",
    actionParams: { query: "会议记录" },
    response: undefined,
  };
  const reactResult = parseReActAgentOutput(reactInput);
  console.log("ReActAgent 验证通过:", reactResult.thought);
  console.assert(reactResult.action === "search", "action 应为 search");
  console.assert(reactResult.actionParams.query === "会议记录", "actionParams.query 应为 会议记录");

  // MainAgent
  const mainInput = {
    thinking: "需要两步处理",
    needSplit: true,
    subtasks: [
      { id: "task-1", description: "整理笔记", assignedTo: "NoteWorker", status: "pending" },
      { id: "task-2", description: "提取待办", assignedTo: "TaskWorker", status: "pending" },
    ],
    directResponse: undefined,
  };
  const mainResult = parseMainAgentOutput(mainInput);
  console.log("MainAgent 验证通过:", mainResult.thinking);
  console.assert(mainResult.needSplit === true, "needSplit 应为 true");
  console.assert(mainResult.subtasks.length === 2, "应有 2 个子任务");
}

// ==================== 测试 2：Zod Schema 错误验证 ====================

async function testSchemaErrorValidation() {
  console.log("\n=== 测试 2：Zod Schema 错误验证 ===");

  // 缺失必填字段
  try {
    parseSimpleAgentOutput({ thinking: "缺少字段" });
    console.assert(false, "应抛出验证错误");
  } catch (error) {
    console.log("缺失字段验证错误（预期行为）:", (error as Error).message?.substring(0, 50));
  }

  // 类型错误
  try {
    parseReActAgentOutput({
      thought: "类型错误测试",
      action: 123,  // 应为 string
      actionParams: {},
    });
    console.assert(false, "应抛出类型验证错误");
  } catch (error) {
    console.log("类型错误验证（预期行为）:", (error as Error).message?.substring(0, 50));
  }

  console.log("✅ Schema 错误验证测试通过");
}

// ==================== 测试 3：StructuredOutputParser ====================

async function testStructuredOutputParser() {
  console.log("\n=== 测试 3：StructuredOutputParser 结构化解析 ===");

  // SimpleAgent - 正常 JSON
  const simpleJson = JSON.stringify({
    thinking: "创建文件",
    needTool: true,
    toolName: "write_file",
    toolParams: { filePath: "test.txt", content: "Hello" },
    response: "已创建文件",
  });
  const simpleResult = StructuredOutputParser.parseSimpleAgent(simpleJson);
  console.log("SimpleAgent 解析结果:", simpleResult.success ? "成功" : "失败");
  console.assert(simpleResult.success === true, "解析应成功");
  console.assert(simpleResult.fallbackUsed === false, "不应使用降级");
  console.assert(simpleResult.data?.toolName === "write_file", "toolName 应为 write_file");

  // ReActAgent - 正常 JSON
  const reactJson = JSON.stringify({
    thought: "完成推理",
    action: "finish",
    actionParams: {},
    response: "任务完成",
  });
  const reactResult = StructuredOutputParser.parseReActAgent(reactJson);
  console.log("ReActAgent 解析结果:", reactResult.success ? "成功" : "失败");
  console.assert(reactResult.success === true, "解析应成功");
  console.assert(reactResult.data?.action === "finish", "action 应为 finish");

  // 解析非 JSON 字符串 - 应失败
  const invalidResult = StructuredOutputParser.parseSimpleAgent("这不是JSON");
  console.log("无效输入解析:", invalidResult.success ? "成功" : "失败（预期）");
  console.assert(invalidResult.success === false, "非 JSON 解析应失败");
  console.assert(invalidResult.fallbackUsed === false, "非 JSON 解析不应标记为降级");
}

// ==================== 测试 4：RegexFallbackParser ====================

async function testRegexFallbackParser() {
  console.log("\n=== 测试 4：RegexFallbackParser 正则降级解析 ===");

  // 纯 JSON - 正常解析
  const pureJson = '{"thinking":"读取文件","needTool":true,"toolName":"read_file","response":"正在读取"}';
  const result1 = RegexFallbackParser.parseSimpleAgentFallback(pureJson);
  console.log("纯 JSON 降级解析:", result1.thinking);
  console.assert(result1.needTool === true, "needTool 应为 true");

  // JSON 嵌入在文本中 - 正则提取
  const embeddedJson = '好的，让我来处理这个请求。{"thinking":"创建文件","needTool":true,"toolName":"write_file","toolParams":{"filePath":"a.txt"},"response":"已创建"}任务完成。';
  const result2 = RegexFallbackParser.parseSimpleAgentFallback(embeddedJson);
  console.log("嵌入 JSON 降级解析:", result2.toolName);
  console.assert(result2.toolName === "write_file", "应提取到 write_file");
  console.assert(result2.needTool === true, "needTool 应为 true");

  // 完全无 JSON - 降级回退
  const noJson = "这是一个简单的回复，没有JSON格式";
  const result3 = RegexFallbackParser.parseSimpleAgentFallback(noJson);
  console.log("无 JSON 降级回退:", result3.thinking);
  console.assert(result3.needTool === false, "无 JSON 时 needTool 应为 false");
  console.assert(result3.response === noJson, "response 应为原始内容");

  // ReActAgent 降级解析
  const reactText = '我认为应该直接回复。{"thought":"直接回复","action":"finish","actionParams":{},"response":"你好！"}';
  const result4 = RegexFallbackParser.parseReActAgentFallback(reactText);
  console.log("ReAct 降级解析 action:", result4.action);
  console.assert(result4.action === "finish", "action 应为 finish");

  // MainAgent 降级解析
  const mainText = '{"thinking":"需要拆分","needSplit":true,"subtasks":[{"id":"t1","description":"整理","assignedTo":"NoteWorker","status":"pending"}],"directResponse":"无"}';
  const result5 = RegexFallbackParser.parseMainAgentFallback(mainText);
  console.log("MainAgent 降级解析 subtasks:", result5.subtasks.length);
  console.assert(result5.needSplit === true, "needSplit 应为 true");
  console.assert(result5.subtasks.length === 1, "应有 1 个子任务");
}

// ==================== 测试 5：统一解析入口 parseAgentOutput ====================

async function testUnifiedParseEntry() {
  console.log("\n=== 测试 5：统一解析入口 parseAgentOutput ===");

  // 正常 JSON - 结构化解析成功
  const validJson = JSON.stringify({
    thinking: "搜索文件",
    needTool: true,
    toolName: "search",
    response: "正在搜索",
  });
  const result1 = parseAgentOutput(
    validJson,
    StructuredOutputParser.parseSimpleAgent,
    RegexFallbackParser.parseSimpleAgentFallback
  );
  console.log("正常 JSON 解析:", result1.thinking);
  console.assert(result1.toolName === "search", "应解析到 search");

  // 非法 JSON - 降级到正则解析
  const invalidJson = '分析结果：{"thinking":"降级解析","needTool":false,"response":"直接回复"}';
  const result2 = parseAgentOutput(
    invalidJson,
    StructuredOutputParser.parseSimpleAgent,
    RegexFallbackParser.parseSimpleAgentFallback
  );
  console.log("非法 JSON 降级解析:", result2.thinking);
  console.assert(result2.needTool === false, "降级解析 needTool 应为 false");
  console.assert(result2.response === "直接回复", "降级解析 response 应正确");
}

// ==================== 测试 6：JSON Schema 生成 ====================

async function testJsonSchemaGeneration() {
  console.log("\n=== 测试 6：JSON Schema 生成 ===");

  const simpleSchema = getSimpleAgentJsonSchema();
  console.log("SimpleAgent JSON Schema:", JSON.stringify(simpleSchema, null, 2).substring(0, 80));
  console.assert((simpleSchema as any).type === "object", "Schema 类型应为 object");
  console.assert((simpleSchema as any).required.includes("thinking"), "thinking 应为必填");
  console.assert((simpleSchema as any).required.includes("needTool"), "needTool 应为必填");

  const reactSchema = getReActAgentJsonSchema();
  console.log("ReActAgent JSON Schema:", JSON.stringify(reactSchema, null, 2).substring(0, 80));
  console.assert((reactSchema as any).required.includes("thought"), "thought 应为必填");
  console.assert((reactSchema as any).required.includes("action"), "action 应为必填");

  const mainSchema = getMainAgentJsonSchema();
  console.log("MainAgent JSON Schema:", JSON.stringify(mainSchema, null, 2).substring(0, 80));
  console.assert((mainSchema as any).required.includes("thinking"), "thinking 应为必填");
  console.assert((mainSchema as any).required.includes("needSplit"), "needSplit 应为必填");
  console.assert((mainSchema as any).properties.subtasks.type === "array", "subtasks 应为 array");
}

// ==================== 运行所有测试 ====================

async function runAllTests() {
  console.log("运行结构化输出测试...\n");

  try {
    await testSchemaValidation();
    await testSchemaErrorValidation();
    await testStructuredOutputParser();
    await testRegexFallbackParser();
    await testUnifiedParseEntry();
    await testJsonSchemaGeneration();

    console.log("\n✅ 所有测试通过！");
  } catch (error) {
    console.error("\n❌ 测试失败:", error);
    process.exit(1);
  }
}

runAllTests();