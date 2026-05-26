import type { Channel } from '@/types'

let channels: Channel[] = []

export const channelService = {
  init(initial: Channel[]) {
    channels = [...initial]
  },

  getAll(): Channel[] {
    return channels
  },

  getById(id: string): Channel | undefined {
    return channels.find(c => c.id === id)
  },

  getDefault(): Channel | undefined {
    return channels.find(c => c.isDefault)
  },

  setDefault(id: string): void {
    channels = channels.map(c => ({ ...c, isDefault: c.id === id }))
  },

  update(id: string, updates: Partial<Channel>): void {
    channels = channels.map(c => c.id === id ? { ...c, ...updates } : c)
  },
}
