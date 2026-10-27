import { useEffect, useState } from 'react'
import type { CharacterConfig } from '@shared/types'

const FALLBACK: CharacterConfig = {
  name: '桌面伴侣',
  alias: '',
  shortName: '伴侣',
  userName: '你'
}

let cache: CharacterConfig | null = null
const listeners = new Set<(c: CharacterConfig) => void>()

function apply(c: CharacterConfig): void {
  cache = c
  listeners.forEach((fn) => fn(c))
}

/** 配置保存后调用，让所有用到角色名的地方立刻刷新 */
export function refreshCharacter(): void {
  void window.api.getConfig().then((cfg) => apply({ ...FALLBACK, ...(cfg.character ?? {}) }))
}

/**
 * 角色设定（名字 / 称呼）。
 * 首次读取后缓存，设置面板保存时调 refreshCharacter() 即时刷新所有引用处。
 */
export function useCharacter(): CharacterConfig {
  const [ch, setCh] = useState<CharacterConfig>(cache ?? FALLBACK)

  useEffect(() => {
    if (cache) {
      setCh(cache)
      return
    }
    let alive = true
    void window.api.getConfig().then((cfg) => {
      if (!alive) return
      const c = { ...FALLBACK, ...(cfg.character ?? {}) }
      apply(c)
      setCh(c)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    listeners.add(setCh)
    return () => {
      listeners.delete(setCh)
    }
  }, [])

  return ch
}
