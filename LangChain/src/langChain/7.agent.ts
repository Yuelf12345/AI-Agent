import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate , MessagesPlaceholder} from "@langchain/core/prompts";
import {createAgent} from 'langchain'
import * as dotenv from "dotenv"
dotenv.config()

export const model = new ChatOpenAI({
  model: "qwen-plus",
  temperature: 0.5,
  maxTokens: 1000,
});

const prompt = ChatPromptTemplate.fromMessages([
    ["system", "回答用户的问题"],
    ["human","{input}"],
    new MessagesPlaceholder("agent_scratchpad")
])

const agent = await createAgent({
  model,
  tools:[]
})
// AgentExecutor