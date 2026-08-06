// 工作模式胶囊的固定顺序：ask / agent(代码) / plan / debug / multitask。
export const WORK_MODES = ["ask", "agent", "plan", "debug", "multitask"] as const

export function hasCustomAgent(items: Array<{ native?: boolean }>) {
  return items.some((item) => item.native === false)
}

// 是否存在内建工作模式 agent。工作模式选择器独立于 customAgents 设置可见。
export function hasWorkMode(items: Array<{ name: string }>) {
  const modes = new Set<string>(WORK_MODES)
  return items.some((item) => modes.has(item.name))
}

export function resolveAgent<T extends { name: string }>(items: T[], name?: string) {
  return items.find((item) => item.name === name) ?? items.find((item) => item.name === "build") ?? items[0]
}
