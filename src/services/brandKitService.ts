import type { BrandKit } from '@/types'

let brandKits: BrandKit[] = []

export const brandKitService = {
  init(kits: BrandKit[]) {
    brandKits = [...kits]
  },

  getByChannelId(channelId: string): BrandKit | undefined {
    return brandKits.find(k => k.channelId === channelId)
  },

  getAll(): BrandKit[] {
    return brandKits
  },

  update(channelId: string, updates: Partial<BrandKit>): void {
    brandKits = brandKits.map(k =>
      k.channelId === channelId ? { ...k, ...updates } : k
    )
  },

  upsert(kit: BrandKit): void {
    const idx = brandKits.findIndex(k => k.channelId === kit.channelId)
    if (idx >= 0) {
      brandKits[idx] = kit
    } else {
      brandKits.push(kit)
    }
  },
}
