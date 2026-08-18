import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { useApp } from './AppContext'

// Guided walkthrough that runs after the intro slides: connect channel →
// fill channel style → create first post. Each step is individually skippable.

export type WalkthroughStep = 'connect' | 'style' | 'create' | null

interface WalkthroughValue {
  step: WalkthroughStep
  start: () => void
  skipStep: () => void
  skipAll: () => void
  notifyStyleOpened: () => void   // call when the user opens the channel-style screen
}

const WalkthroughContext = createContext<WalkthroughValue | undefined>(undefined)

const DONE_KEY = 'cf_walkthrough_done'

function markDone() {
  try { localStorage.setItem(DONE_KEY, '1') } catch {}
}
function isDone(): boolean {
  try { return !!localStorage.getItem(DONE_KEY) } catch { return false }
}

export function WalkthroughProvider({ children }: { children: React.ReactNode }) {
  const { state } = useApp()
  const [step, setStep] = useState<WalkthroughStep>(null)

  const channelCount = state.channels.filter(channel => channel.kind !== 'chat').length
  const postCount    = state.posts.length
  // Baseline post count captured when the 'create' step begins — finishing when
  // a new post appears.
  const createBaseline = useRef<number | null>(null)

  const finish = useCallback(() => {
    markDone()
    createBaseline.current = null
    setStep(null)
  }, [])

  const start = useCallback(() => {
    if (isDone()) return
    // Skip steps already satisfied: a user who somehow already has a channel
    // starts at the style step.
    setStep(channelCount > 0 ? 'style' : 'connect')
  }, [channelCount])

  const skipStep = useCallback(() => {
    setStep(prev => {
      if (prev === 'connect') return 'style'
      if (prev === 'style')   return 'create'
      markDone()
      return null
    })
  }, [])

  const skipAll = useCallback(() => { finish() }, [finish])

  const notifyStyleOpened = useCallback(() => {
    setStep(prev => (prev === 'style' ? 'create' : prev))
  }, [])

  // Auto-advance: connect → style once a channel is connected.
  useEffect(() => {
    if (step === 'connect' && channelCount > 0) setStep('style')
  }, [step, channelCount])

  // Capture baseline when entering the create step; finish when a post is added.
  useEffect(() => {
    if (step === 'create') {
      if (createBaseline.current === null) createBaseline.current = postCount
      else if (postCount > createBaseline.current) finish()
    }
  }, [step, postCount, finish])

  return (
    <WalkthroughContext.Provider value={{ step, start, skipStep, skipAll, notifyStyleOpened }}>
      {children}
    </WalkthroughContext.Provider>
  )
}

export function useWalkthrough(): WalkthroughValue {
  const ctx = useContext(WalkthroughContext)
  if (!ctx) throw new Error('useWalkthrough must be used within WalkthroughProvider')
  return ctx
}
