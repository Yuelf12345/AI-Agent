/**
 * 
错误类型	                        谁来修理它	            战略	                何时使用
瞬态错误（网络问题、速率限制）	        系统（自动）	        重试策略	         临时故障，通常在重试后解决。
LLM 可恢复错误（工具故障、解析问题）	 LLM	    将错误存储在状态中并循环返回	LLM能够发现错误并调整其方法
用户可修正的错误（信息缺失、说明不清晰）	人类	    暂停interrupt()	             需要用户输入才能继续
意外错误	                          开发者	    让它们冒泡吧	             未知问题需要调试
 */

// 1. 瞬态错误 重试
// import type { RetryPolicy } from "@langchain/langgraph";
// workflow.addNode(
//   "searchDocumentation",
//   searchDocumentation,
//   {
//     retryPolicy: { maxAttempts: 3, initialInterval: 1.0 },
//   },
// );

// 2. LLM 可恢复错误（工具故障、解析问题）
// import { Command, GraphNode } from "@langchain/langgraph";
// const executeTool: GraphNode<typeof State> = async (state, config) => {
//   try {
//     const result = await runTool(state.toolCall);
//     return new Command({
//       update: { toolResult: result },
//       goto: "agent",
//     });
//   } catch (error) {
//     // Let the LLM see what went wrong and try again
//     return new Command({
//       update: { toolResult: `Tool error: ${error}` },
//       goto: "agent"
//     });
//   }
// }

// 3. 暂停处理等待用户输入
// import { Command, GraphNode, interrupt } from "@langchain/langgraph";
// const lookupCustomerHistory: GraphNode<typeof State> = async (state, config) => {
//   if (!state.customerId) {
//     const userInput = interrupt({
//       message: "Customer ID needed",
//       request: "Please provide the customer's account ID to look up their subscription history",
//     });
//     return new Command({
//       update: { customerId: userInput.customerId },
//       goto: "lookupCustomerHistory",
//     });
//   }
//   // Now proceed with the lookup
//   const customerData = await fetchCustomerHistory(state.customerId);
//   return new Command({
//     update: { customerHistory: customerData },
//     goto: "draftResponse",
//   });
// }

// 4. 意外错误
// import { Command, GraphNode } from "@langchain/langgraph";
// const sendReply: GraphNode<typeof EmailAgentState> = async (state, config) => {
//   try {
//     await emailService.send(state.responseText);
//   } catch (error) {
//     throw error;  // Surface unexpected errors
//   }
// }