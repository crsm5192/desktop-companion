import { useEffect } from 'react'
import { ControlError, validateControlCommand } from '@shared/control'
import { live2dControllerRef } from '../lib/live2dControl'
import { useTTS } from './useTTS'
import { usePetStore } from '../store/pet'

export function usePetControl(): void {
  const { speak, stop } = useTTS()
  useEffect(() => usePetStore.subscribe((state, previous) => {
    if (!state.modelReady && previous.modelReady) stop()
  }), [stop])
  useEffect(() => window.api.control.onCommand(request => {
    void (async () => {
      try {
        const controller = live2dControllerRef.current
        if (!controller) throw new ControlError('MODEL_NOT_READY', '模型尚未加载')
        const command = validateControlCommand(request.type, request.data)
        let data: unknown
        if (command.type === 'speech.play') {
          if (!await speak(command.data.text, { performance: command.data.performance })) throw new ControlError('SPEECH_FAILED', '语音合成或播放失败')
          data = { playing: true }
        } else {
          if (command.type === 'control.reset') stop()
          data = await controller.execute(command)
        }
        window.api.control.reply({ id: request.id, ok: true, data })
      } catch (err) {
        window.api.control.reply({ id: request.id, ok: false, error: { code: err instanceof ControlError ? err.code : 'EXECUTION_FAILED', message: err instanceof Error ? err.message : String(err) } })
      }
    })()
  }), [speak, stop])
}
