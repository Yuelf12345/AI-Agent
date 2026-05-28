import { ChatOpenAI } from "@langchain/openai";
import { createAgent, tool } from "langchain";
import * as dotenv from "dotenv"
dotenv.config()

const model = new ChatOpenAI({
  model: "qwen-plus",
  temperature: 0.5,
  maxTokens: 1000,
});

const sendEmail = tool(
    ({ to, subject, body }) => {
        console.log(`Sending email to ${to} with subject ${subject} and body ${body}`);
        return `Email sent to ${to}`;
    },
    {
        name: "sendEmail",
        description: "Send an email to a recipient",
        schema: {
            type: "object",
            properties: {
                to: { type: "string", description: "The email address of the recipient" },
                subject: { type: "string", description: "The subject of the email" },
                body: { type: "string", description: "The body of the email" },
            },
            required: ["to", "subject", "body"],
        },
    }
);

const agent = createAgent({
    model,
    tools: [sendEmail],
    systemPrompt: "You are an email assistant. Always use the sendEmail tool.",
});

export { agent };