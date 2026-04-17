import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types";
import { z } from "zod";

const NWS_API_BASE = "https://api.weather.gov";
const USER_AGENT = "weather-app/1.0";

const AlertArgumentsSchema = z.object({
  state: z.string().length(2),
});

const ForecastArgumentsSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

// 创建 MCP 服务器实例
const server = new McpServer(
  {
    name: "weather-tools",
    version: "1.0.0",
  },
  {
    capabilities: {},
  },
);

// 创建有哪些工具可用
server.registerTool(
  "getWeatherAlerts",
  {
    title: "Get Weather Alerts",
    description: "Get weather alerts for a state",
    inputSchema: AlertArgumentsSchema,
  },
  async ({ state }) => {
    const response = await fetch(
      `${NWS_API_BASE}/alerts/active?area=${state}`,
      {
        headers: { "User-Agent": USER_AGENT },
      },
    );
    const data = await response.json();
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

server.registerTool(
  "getWeatherForecast",
  {
    title: "Get Weather Forecast",
    description: "Get weather forecast for a location",
    inputSchema: ForecastArgumentsSchema,
  },
  async ({ latitude, longitude }) => {
    const response = await fetch(
      `${NWS_API_BASE}/points/${latitude},${longitude}`,
    );
    const data = await response.json();
    const forecastUrl = data.properties.forecast;
    const forecastResponse = await fetch(forecastUrl, {
      headers: { "User-Agent": USER_AGENT },
    });
    const forecastData = await forecastResponse.json();
    return { content: [{ type: "text", text: JSON.stringify(forecastData) }] };
  },
);

const main = async () => {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log("MCP 服务已启动");
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
};

main();
