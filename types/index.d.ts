export type Window = { percent: number; resetsAt?: string }
export type Reading = { five: Window | null; week: Window | null; at: number; isLive: boolean }

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { reading: Reading | null; warned: string[] }
  }
}
