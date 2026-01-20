import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import executeShortcut from "./execute";

async function qishui_music_control(command: string) {
  if (command === "play") {
    await executeShortcut("Command+Option+1");
    return true;
  }
  if (command === "pause") {
    await executeShortcut("Command+Option+1");
    return true;
  }
  if (command === "next") {
    await executeShortcut("Command+Option+3");
    return true;
  }
  if (command === "previous") {
    await executeShortcut("Command+Option+2");
    return true;
  }
  if (command === "volume_up") {
    await executeShortcut("Command+Option+4");
    return true;
  }
  if (command === "volume_down") {
    await executeShortcut("Command+Option+5");
    return true;
  }

  return false;
}

export default function (server: McpServer) {
  server.registerTool(
    "qishui_music_control",
    {
      description: "用于汽水音乐APP的控制工具",
      inputSchema: {
        command: z.string().describe(
          `要执行的汽水音乐APP的控制命令如下：
              'play' 播放音乐，
              'pause' 暂停音乐，
              'next' 下一首音乐，
              'previous' 上一首音乐，
              'volume_up' 增加音量，
              'volume_down' 减少音量
            `
        ),
      },
    },
    async (args) => {
      const command = args.command as string;
      console.log(`[qishui_music_control] 执行命令: ${command}`);
      const success = await qishui_music_control(command);
      if (success) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: "qishui_music",
              }),
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              message: "qishui_music_control failed",
            }),
          },
        ],
      };
    }
  );
}

// qishui_music_control("volume_up"); // Test code - commented out

