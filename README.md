## 本工程是MOSS - XIAOZHI PC端MCP客户端
本工程能支持 安装第三方 MCP工具，支持 sse 及 Streamable 连接 MCP Server

## 接入点配置
.env文件
- MCP WebSocket 端点
MCP_ENDPOINT=wss://api.xiaozhi.me/mcp/?token=xxx
- 日志级别: DEBUG, INFO, WARN, ERROR
LOG_LEVEL=ERROR

## 安装命令
`pnpm install`

## 启动命令
`pnpm start`


## 配置文件
```JSON
// mcp_config.json
{
  "mcpServers": {
    "yo-onvif-mcp": {
      "command": "npx",
      "args": ["yo-onvif-mcp"],
      "env": {
        "ONVIF_USERNAME": "admin",
        "ONVIF_PASSWORD": "admin123",
        "ONVIF_XADDR": "http://192.168.31.10:80/onvif/device_service"
      }
    },
    "yo-execute-shortcuts-mcp": {
      "command": "npx",
      "args": ["yo-execute-shortcuts-mcp", "--config", "yo-execute-shortcuts-mcp.json"]
    }
  }
}
```

## Requirements | 环境要求
- pnpm 
- Node.js 18+ 
- TypeScript 5.5+
- @modelcontextprotocol/sdk>=1.0.4
- ws>=8.18.0
- dotenv>=16.4.5
- mathjs>=12.2.0
