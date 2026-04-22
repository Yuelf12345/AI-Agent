import express from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import apiRouter from './api/index.js';
import { storageService } from './services/index.js';
import { agent } from './harness/index.js';

const app = express();

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 请求日志
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// API 路由
app.use('/api', apiRouter);

// 根路由
app.get('/', (_req, res) => {
  res.json({
    name: 'Personal Knowledge Butler',
    version: '1.0.0',
    endpoints: {
      chat: 'POST /api/chat',
      conversations: 'GET /api/conversations',
      tools: 'GET /api/tools',
      notes: 'GET /api/notes',
      health: 'GET /api/health'
    }
  });
});

// 错误处理
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: err.message || 'Internal Server Error'
  });
});

// 启动服务
async function start() {
  try {
    // 初始化存储服务
    await storageService.init();
    console.log('[Server] Storage initialized');

    // 初始化 Agent
    await agent.init();
    console.log('[Server] Agent initialized');

    // 启动 HTTP 服务
    app.listen(config.server.port, config.server.host, () => {
      console.log(`[Server] Running on http://${config.server.host}:${config.server.port}`);
      console.log(`[Server] API endpoints available at /api`);
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  storageService.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Server] Shutting down...');
  storageService.close();
  process.exit(0);
});

start();
