import robotjs from 'robotjs'

/**
 * 解析快捷键字符串，分离修饰键和主键
 * @param shortcut 快捷键字符串，如 "Command+W" 或 "Ctrl+Shift+3"
 * @returns { key: string, modifiers: string[] } 主键和修饰键数组
 */
export function parseShortcut(shortcut: string): { key: string; modifiers: string[] } {
  // 修饰键映射：将用户输入的格式转换为 robotjs 识别的格式
  const modifierMap: Record<string, string> = {
    command: 'command',
    cmd: 'command',
    ctrl: 'control',
    control: 'control',
    alt: 'alt',
    option: 'alt',
    shift: 'shift',
    meta: 'command',
  }

  const parts = shortcut
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0)

  if (parts.length === 0) {
    throw new Error('快捷键格式无效：至少需要一个按键')
  }

  const modifiers: string[] = []
  let key = ''

  // 最后一个部分通常是主键，前面的都是修饰键
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (modifierMap[part]) {
      modifiers.push(modifierMap[part])
    } else {
      // 第一个非修饰键部分就是主键（通常是最后一个）
      if (!key) {
        key = part
      }
    }
  }

  if (!key) {
    throw new Error('快捷键格式无效：缺少主键')
  }

  return { key, modifiers }
}

/**
 * 执行快捷键
 * @param shortcut 快捷键字符串，如 "Command+Shift+3" 或 "Ctrl+Shift+4"
 * @returns 执行结果
 */
export default function executeShortcut(shortcut: string) {
  const { key, modifiers } = parseShortcut(shortcut)
  if (modifiers.length > 0) {
    robotjs.keyTap(key, modifiers.length === 1 ? modifiers[0] : modifiers)
  } else {
    robotjs.keyTap(key)
  }
  console.log(`[executeShortcut] 执行成功: ${shortcut} -> key: ${key}, modifiers: ${modifiers.join(', ')}`)
  return {
    success: true,
    key,
    modifiers,
  }
}