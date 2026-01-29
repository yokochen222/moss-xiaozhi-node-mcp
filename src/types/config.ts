/**
 * MCP 服务器配置类型定义
 */

export type TransportType = 'stdio' | 'sse' | 'http' | 'streamablehttp';

export interface ServerConfig {
  type?: TransportType;
  transportType?: TransportType;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  disabled?: boolean;
}

export interface MCPConfig {
  mcpServers?: Record<string, ServerConfig>;
}

export interface ServerCommand {
  cmd: string[];
  env: Record<string, string>;
}
