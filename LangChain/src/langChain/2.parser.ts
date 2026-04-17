import {
  StringOutputParser,
  CommaSeparatedListOutputParser,
} from "@langchain/core/output_parsers";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";

// 1. 普通解析器
const outputParser = new StringOutputParser();

// 2. 解析为逗号分隔的列表
const commaSeparatedListParser = new CommaSeparatedListOutputParser();

// 3. 解析为结构化数据
const callStructuredParser = StructuredOutputParser.fromNamesAndDescriptions({
  name: "这个人的名字",
  age: "这个人的年龄",
});

// 4. zod解析器
const schema1 = z.object({
  name: z.string().describe("水果名称"),
  type: z.array(z.string()).describe("水果特征,至少包含3个特征"),
});
// model.withStructuredOutput(schema);

// 5. zod
const schema2 = z.object({
  name: z.string().describe("水果名称"),
  type: z.array(z.string()).describe("水果特征"),
});
const structuredOutputParser = StructuredOutputParser.fromZodSchema(schema2);
const formatInstructions = structuredOutputParser.getFormatInstructions();
