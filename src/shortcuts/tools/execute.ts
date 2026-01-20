import { keyboard, Key } from '@nut-tree-fork/nut-js'

/**
 * 解析快捷键字符串，分离修饰键和主键
 * @param shortcut 快捷键字符串，如 "Command+W" 或 "Ctrl+Shift+3"
 * @returns { key: string, modifiers: string[] } 主键和修饰键数组
 */
export function parseShortcut(shortcut: string): { key: string; modifiers: string[] } {
  // 修饰键映射：将用户输入的格式转换为 nut-js 识别的格式
  const modifierMap: Record<string, string> = {
    command: 'Command',
    cmd: 'Command',
    ctrl: 'Control',
    control: 'Control',
    alt: 'Alt',
    option: 'Alt',
    shift: 'Shift',
    meta: 'Command',
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
export default async function executeShortcut(shortcut: string) {
  const { key, modifiers } = parseShortcut(shortcut)
  
  // 将字符串转换为 nut-js 的 Key 和 Modifier 枚举
  const keyMap: Record<string, Key> = {
    // 数字键
    '0': Key.Num0, '1': Key.Num1, '2': Key.Num2, '3': Key.Num3, '4': Key.Num4,
    '5': Key.Num5, '6': Key.Num6, '7': Key.Num7, '8': Key.Num8, '9': Key.Num9,
    // 字母键
    'a': Key.A, 'b': Key.B, 'c': Key.C, 'd': Key.D, 'e': Key.E, 'f': Key.F,
    'g': Key.G, 'h': Key.H, 'i': Key.I, 'j': Key.J, 'k': Key.K, 'l': Key.L,
    'm': Key.M, 'n': Key.N, 'o': Key.O, 'p': Key.P, 'q': Key.Q, 'r': Key.R,
    's': Key.S, 't': Key.T, 'u': Key.U, 'v': Key.V, 'w': Key.W, 'x': Key.X,
    'y': Key.Y, 'z': Key.Z,
    // 功能键
    'f1': Key.F1, 'f2': Key.F2, 'f3': Key.F3, 'f4': Key.F4,
    'f5': Key.F5, 'f6': Key.F6, 'f7': Key.F7, 'f8': Key.F8,
    'f9': Key.F9, 'f10': Key.F10, 'f11': Key.F11, 'f12': Key.F12,
    // 特殊键
    'enter': Key.Enter, 'return': Key.Enter, 'space': Key.Space,
    'tab': Key.Tab, 'escape': Key.Escape, 'esc': Key.Escape,
    'backspace': Key.Backspace, 'delete': Key.Delete, 'del': Key.Delete,
    'up': Key.Up, 'down': Key.Down, 'left': Key.Left, 'right': Key.Right,
    'home': Key.Home, 'end': Key.End, 'pageup': Key.PageUp, 'pagedown': Key.PageDown,
  }

  // 修饰键映射：将字符串转换为 Key 枚举值
  // 在 macOS 上，Command 键使用 LeftSuper
  const modifierMap: Record<string, Key> = {
    'Command': Key.LeftSuper,  // macOS Command key
    'Control': Key.LeftControl,
    'Alt': Key.LeftAlt,
    'Shift': Key.LeftShift,
  }

  const nutKey = keyMap[key.toLowerCase()]
  if (!nutKey) {
    throw new Error(`不支持的按键: ${key}`)
  }

  const nutModifiers = modifiers.map(m => modifierMap[m]).filter(Boolean) as Key[]

  if (nutModifiers.length > 0) {
    await keyboard.pressKey(...nutModifiers, nutKey)
    await keyboard.releaseKey(...nutModifiers, nutKey)
  } else {
    await keyboard.pressKey(nutKey)
    await keyboard.releaseKey(nutKey)
  }

  console.log(`[executeShortcut] 执行成功: ${shortcut} -> key: ${key}, modifiers: ${modifiers.join(', ')}`)
  return {
    success: true,
    key,
    modifiers,
  }
}
executeShortcut('Command+A')