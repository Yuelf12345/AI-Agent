import { ChatPromptTemplate } from "@langchain/core/prompts";

const prompt = ChatPromptTemplate.fromTemplate('讲一个关于 {input} 的笑话')