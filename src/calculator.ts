#!/usr/bin/env node

/**
 * MCP 计算器服务器
 * 提供数学计算工具，可以执行 Python 风格的数学表达式
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as math from 'mathjs';

// 创建 MCP 服务器实例
const server = new McpServer(
  {
    name: 'calculator',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * 注册计算器工具
 */
server.registerTool(
  'calculator',
  {
    description:
      '用于数学计算，使用此工具计算 Python 表达式的值。可以直接使用 "math" 或 "random"，无需 "import"。',
    inputSchema: {
      python_expression: z
        .string()
        .describe('要计算的 Python 数学表达式'),
    },
  },
  async (args) => {
    const expression = args.python_expression as string;
    if (!expression) {
      throw new Error('缺少 python_expression 参数');
    }

    try {
      // 使用 mathjs 来安全地计算数学表达式
      // 创建一个安全的评估上下文，包含 math 和 random 对象
      const scope: Record<string, any> = {
        math: math,
        random: {
          random: Math.random,
          uniform: (a: number, b: number) => Math.random() * (b - a) + a,
          randint: (a: number, b: number) =>
            Math.floor(Math.random() * (b - a + 1)) + a,
        },
      };

      // 使用 mathjs 的 evaluate 函数来安全地计算表达式
      const result = math.evaluate(expression, scope);

      console.error(
        `[Calculator] 计算表达式: ${expression}, 结果: ${result}`
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              result: result,
            }),
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[Calculator] 计算错误: ${errorMessage}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: errorMessage,
            }),
          },
        ],
        isError: true,
      };
    }
  }
);

/**
 * 启动服务器
 */
async function main() {
  // 使用 stdio 传输方式
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Calculator] MCP 计算器服务器已启动');
}

// 处理未捕获的错误
process.on('uncaughtException', (error) => {
  console.error('[Calculator] 未捕获的异常:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Calculator] 未处理的 Promise 拒绝:', reason);
  process.exit(1);
});

// 运行服务器
main().catch((error) => {
  console.error('[Calculator] 启动失败:', error);
  process.exit(1);
});
