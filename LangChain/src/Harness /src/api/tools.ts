import { Router, Request, Response } from 'express';
import { agent } from '../harness/index.js';

const router = Router();

/**
 * GET /api/tools
 * 获取所有可用的 Tools
 */
router.get('/', (_req: Request, res: Response) => {
  const tools = agent.getAvailableTools();
  res.json({
    count: tools.length,
    tools: tools.map(name => ({ name }))
  });
});

/**
 * POST /api/tools/invoke
 * 直接调用 Tool
 */
router.post('/invoke', async (req: Request, res: Response) => {
  const { tool_name, parameters } = req.body;

  if (!tool_name) {
    res.status(400).json({ error: 'tool_name is required' });
    return;
  }

  try {
    const result = await agent.invokeTool(tool_name, parameters || {});
    res.json({
      tool: tool_name,
      success: true,
      result
    });
  } catch (error) {
    res.status(500).json({
      tool: tool_name,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
