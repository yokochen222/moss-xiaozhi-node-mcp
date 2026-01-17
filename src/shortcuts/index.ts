#!/usr/bin/env node

/**
 * MCP 快捷键服务器
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { logger } from '../utils';

import qishui_music from './tools/qishui_music'
const MCP_NAME = 'shortcuts_mcp'

// 创建 MCP 服务器实例
const server = new McpServer(
  {
    name: MCP_NAME,
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

qishui_music(server)
/**
 * 启动服务器
 */
async function main() {
  // 使用 stdio 传输方式
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

// 处理未捕获的错误
process.on('uncaughtException', (error) => {
  logger.error(`[${MCP_NAME}] 未捕获的异常:`, error)
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`[${MCP_NAME}] 未处理的 Promise 拒绝:`, reason)
  process.exit(1)
})

// 运行服务器
main().catch((error) => {
  logger.error(`[${MCP_NAME}] 启动失败:`, error)
  process.exit(1)
})
