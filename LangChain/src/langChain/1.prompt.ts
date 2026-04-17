import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";

const prompt = ChatPromptTemplate.fromTemplate(`
    回答用户的问题.
    内容: {content}
    问题: {input}
  `);

const messages = ChatPromptTemplate.fromMessages([
  ["system", "根据用户输入想一个笑话"],
  ["user", "{input}"],
]);

const historyPrompt = ChatPromptTemplate.fromMessages([
  ["system", "回答用户的问题"],
    new MessagesPlaceholder("chat_history"), // 占位插槽
  ["user", "{input}"],
]);
export { prompt,historyPrompt, messages };