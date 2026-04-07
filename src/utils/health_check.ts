/**
 * 健康检查和心跳机制
 */

import WebSocket from 'ws';
import { logger } from './logger.js';

const HEARTBEAT_INTERVAL = 30000;  // 心跳间隔（毫秒）
const HEARTBEAT_TIMEOUT = 10000;   // 心跳超时（毫秒）

export interface ServerHealth {
  name: string;
  connected: boolean;
  lastHeartbeat: number;
  reconnectCount: number;
  startTime: number;
}

export interface HealthMonitor {
  getHealth: () => ServerHealth[];
  start: () => void;
  stop: () => void;
}

/**
 * 创建健康监控器
 */
export function createHealthMonitor(
  targets: Array<{ name: string; websocket: WebSocket | null }>
): HealthMonitor {
  const healthMap = new Map<string, ServerHealth>();
  const heartbeatTimers = new Map<string, NodeJS.Timeout>();
  let monitorInterval: NodeJS.Timeout | null = null;

  // 初始化健康状态
  for (const target of targets) {
    healthMap.set(target.name, {
      name: target.name,
      connected: false,
      lastHeartbeat: Date.now(),
      reconnectCount: 0,
      startTime: Date.now(),
    });
  }

  /**
   * 更新服务器连接状态
   */
  const updateHealth = (name: string, connected: boolean) => {
    const health = healthMap.get(name);
    if (health) {
      const wasConnected = health.connected;
      health.connected = connected;
      health.lastHeartbeat = Date.now();

      if (!wasConnected && connected) {
        logger.info(`[${name}] 健康检查: 连接已恢复`);
      } else if (wasConnected && !connected) {
        health.reconnectCount++;
        logger.warning(`[${name}] 健康检查: 连接已断开 (重连次数: ${health.reconnectCount})`);
      }
    }
  };

  /**
   * 记录心跳
   */
  const recordHeartbeat = (name: string) => {
    const health = healthMap.get(name);
    if (health) {
      health.lastHeartbeat = Date.now();
    }
  };

  /**
   * 检查心跳超时
   */
  const checkHeartbeats = () => {
    const now = Date.now();
    for (const [name, health] of healthMap.entries()) {
      if (health.connected) {
        const elapsed = now - health.lastHeartbeat;
        if (elapsed > HEARTBEAT_TIMEOUT) {
          logger.warning(`[${name}] 健康检查: 心跳超时 (${elapsed}ms)`);
        }
      }
    }
  };

  /**
   * 打印健康状态报告
   */
  const printHealthReport = () => {
    const report: string[] = [];
    report.push('\n========== 健康检查报告 ==========\n');

    for (const [name, health] of healthMap.entries()) {
      const uptime = Math.floor((Date.now() - health.startTime) / 1000);
      const minutes = Math.floor(uptime / 60);
      const seconds = uptime % 60;
      const status = health.connected ? '✅ 已连接' : '❌ 已断开';
      const lastHeartbeat = new Date(health.lastHeartbeat).toLocaleTimeString();

      report.push(
        `[${name}]\n` +
        `  状态: ${status}\n` +
        `  运行时间: ${minutes}m ${seconds}s\n` +
        `  最后心跳: ${lastHeartbeat}\n` +
        `  重连次数: ${health.reconnectCount}\n`
      );
    }

    report.push('================================\n');
    logger.info(report.join('\n'));
  };

  return {
    /**
     * 获取当前健康状态
     */
    getHealth: () => {
      return Array.from(healthMap.values());
    },

    /**
     * 启动健康监控
     */
    start: () => {
      if (monitorInterval) {
        return;
      }

      logger.info('健康检查监控已启动');

      // 每分钟打印一次健康报告
      monitorInterval = setInterval(() => {
        checkHeartbeats();
        printHealthReport();
      }, 60000);

      // 立即打印一次报告
      printHealthReport();
    },

    /**
     * 停止健康监控
     */
    stop: () => {
      if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
      }

      for (const timer of heartbeatTimers.values()) {
        clearInterval(timer);
      }
      heartbeatTimers.clear();

      logger.info('健康检查监控已停止');
    },
  };
}

/**
 * 为 WebSocket 添加心跳机制
 */
export function setupWebSocketHeartbeat(
  websocket: WebSocket,
  name: string,
  onHeartbeat?: () => void
): () => void {
  let isAlive = true;
  let pingTimer: NodeJS.Timeout | null = null;
  let pongTimer: NodeJS.Timeout | null = null;

  websocket.on('pong', () => {
    isAlive = true;
    if (pongTimer) {
      clearTimeout(pongTimer);
      pongTimer = null;
    }
  });

  const sendPing = () => {
    if (websocket.readyState === WebSocket.OPEN) {
      try {
        websocket.ping();
        isAlive = false;

        // 设置超时，如果没收到 pong 则认为连接已断开
        pongTimer = setTimeout(() => {
          if (!isAlive) {
            logger.warning(`[${name}] 心跳超时，终止连接`);
            websocket.terminate();
          }
        }, HEARTBEAT_TIMEOUT);
      } catch (e) {
        logger.debug(`[${name}] 发送心跳失败: ${e}`);
      }
    }
  };

  pingTimer = setInterval(sendPing, HEARTBEAT_INTERVAL);

  // 立即发送一次心跳
  sendPing();
  onHeartbeat?.();

  // 返回清理函数
  return () => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (pongTimer) {
      clearTimeout(pongTimer);
      pongTimer = null;
    }
    if (websocket.readyState === WebSocket.OPEN) {
      websocket.pong();
    }
  };
}
