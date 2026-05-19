import http from "node:http";
import { config } from "./config/index.ts";
import { llmService } from "./services/llm.ts";
import { SimpleAgent } from "./harness/agents/simpleAgent.ts";

const PORT = config.server.port;
const HOST = config.server.host;

/**
 * Harness HTTP 服务
 *
 * 提供 REST API 供前端调用
 */

// 解析请求体
function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// JSON 响应
function jsonResponse(res: http.ServerResponse, data: any, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

// 路由处理
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  const url = req.url || "/";
  const method = req.method || "GET";

  // CORS 预检
  if (method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try {
    // POST /api/chat - LLM 对话
    if (url === "/api/chat" && method === "POST") {
      const body = await parseBody(req);
      const { message, messages } = body;

      if (!message && !messages) {
        return jsonResponse(res, { error: "消息不能为空" }, 400);
      }

      // 构建消息列表
      const chatMessages = messages || [
        { role: "user", content: message },
      ];

      const response = await llmService.chat(chatMessages);
      return jsonResponse(res, { response });
    }

    // POST /api/agent/simple - SimpleAgent
    if (url === "/api/agent/simple" && method === "POST") {
      const body = await parseBody(req);
      const { message } = body;

      if (!message) {
        return jsonResponse(res, { error: "消息不能为空" }, 400);
      }

      const agent = new SimpleAgent();
      const result = await agent.execute(message);
      return jsonResponse(res, { result });
    }

    // GET /api/health - 健康检查
    if (url === "/api/health") {
      return jsonResponse(res, {
        status: "ok",
        model: config.llm.openai.model,
        provider: config.llm.provider,
      });
    }

    // 404
    jsonResponse(res, { error: "Not Found" }, 404);
  } catch (error) {
    console.error("[Server] Error:", error);
    jsonResponse(
      res,
      { error: error instanceof Error ? error.message : "服务器错误" },
      500,
    );
  }
}

// 启动服务
const server = http.createServer(handleRequest);

server.listen(PORT, HOST, () => {
  console.log(`[Harness] 服务启动: http://${HOST}:${PORT}`);
  console.log(`[Harness] 模型: ${config.llm.openai.model}`);
});

export default server;