MCP（模型上下文协议）是一个允许服务器向语言模型暴露可调用工具的协议。这些工具使模型能够与外部系统交互，例如查询数据库、调用API或执行计算。每个工具都由一个唯一的名称标识，并包含描述其模式的元数据。

## Features | 特性

- 🔌 Bidirectional communication between AI and external tools | AI与外部工具之间的双向通信
- 🔄 Automatic reconnection with exponential backoff | 具有指数退避的自动重连机制
- 📊 Real-time data streaming | 实时数据流传输
- 🛠️ Easy-to-use tool creation interface | 简单易用的工具创建接口
- 🔒 Secure WebSocket communication | 安全的WebSocket通信
- ⚙️ Multiple transport types support (stdio/sse/http) | 支持多种传输类型（stdio/sse/http）

## Quick Start | 快速开始

1. Install dependencies | 安装依赖:
```bash
npm install
```

2. Build the project | 编译项目:
```bash
npm run build
```

3. Set up environment variables | 设置环境变量:
```bash
export MCP_ENDPOINT=<your_mcp_endpoint>
```

4. Run the calculator example | 运行计算器示例:
```bash
npm run start:calculator
# 或使用管道程序
npm run start:pipe dist/calculator.js
```

Or run all configured servers | 或运行所有配置的服务:
```bash
npm run start:pipe
```

*Requires `mcp_config.json` configuration file with server definitions (supports stdio transport type)*

*需要 `mcp_config.json` 配置文件定义服务器（支持 stdio 传输类型）*

## Project Structure | 项目结构

- `src/calculator.ts`: MCP 计算器服务器实现 | MCP calculator server implementation
- `src/mcp_pipe.ts`: 处理 WebSocket 连接和进程管理的主通信管道 | Main communication pipe that handles WebSocket connections and process management
- `dist/`: 编译后的 JavaScript 文件目录 | Compiled JavaScript files directory
- `package.json`: Node.js 项目依赖配置 | Node.js project dependencies configuration
- `tsconfig.json`: TypeScript 编译配置 | TypeScript compilation configuration
- `mcp_config.json`: MCP 服务器配置文件 | MCP server configuration file

## Config-driven Servers | 通过配置驱动的服务

编辑 `mcp_config.json` 文件来配置服务器列表（也可设置 `MCP_CONFIG` 环境变量指向其他配置文件）。

配置说明：
- 启动所有配置的服务（自动跳过 `disabled: true` 的条目）
- 仅支持 `type=stdio` 类型的服务器

## Creating Your Own MCP Tools | 创建自己的MCP工具

Here's a simple example of creating an MCP tool | 以下是一个创建 MCP 工具的简单示例:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer(
  {
    name: 'YourToolName',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.registerTool(
  'your_tool',
  {
    description: '工具描述',
    inputSchema: {
      parameter: z.string().describe('参数描述'),
    },
  },
  async (args) => {
    // 你的实现
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, result: 'result' }),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

## Use Cases | 使用场景

- Mathematical calculations | 数学计算
- Email operations | 邮件操作
- Knowledge base search | 知识库搜索
- Remote device control | 远程设备控制
- Data processing | 数据处理
- Custom tool integration | 自定义工具集成

## Requirements | 环境要求

- Node.js 18+ 
- TypeScript 5.5+
- @modelcontextprotocol/sdk>=1.0.4
- ws>=8.18.0
- dotenv>=16.4.5
- mathjs>=12.2.0
