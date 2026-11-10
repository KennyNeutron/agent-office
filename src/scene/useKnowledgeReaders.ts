import { useEffect, useMemo, useState } from 'react'
import type { OfficeTask } from '../types'
import { activeReaders, KNOWLEDGE_RECENT_MS, knowledgeReaders, type KnowledgeReader } from './knowledgeGraphLayout'

/** Agents currently reading the graph; re-renders once when the next reading expires. */
export function useKnowledgeReaders(tasks: OfficeTask[]): KnowledgeReader[] {
  const all = useMemo(() => knowledgeReaders(tasks), [tasks])
  const [now, setNow] = useState(() => Date.now())
  // Refresh the clock once per task snapshot (same pattern as the scene's pose clock).
  useEffect(() => {
    const timer = window.setTimeout(() => setNow(Date.now()), 0)
    return () => window.clearTimeout(timer)
  }, [all])
  const active = useMemo(() => activeReaders(all, now), [all, now])
  useEffect(() => {
    if (!active.length) return
    const wait = Math.min(...active.map(reader => reader.at + KNOWLEDGE_RECENT_MS)) - now + 25
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(25, wait))
    return () => window.clearTimeout(timer)
  }, [active, now])
  return active
}
