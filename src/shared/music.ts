import type { MusicInfo } from './types'

export interface MusicPlaybackState {
  songs: MusicInfo[]
  index: number
  playing: boolean
  shuffle: boolean
  progress: number
  duration: number
}
export type MusicPlaybackCommand =
  | { type: 'loadSongs' | 'togglePlay' | 'next' | 'prev' | 'toggleShuffle' }
  | { type: 'play' | 'seek'; value: number }
