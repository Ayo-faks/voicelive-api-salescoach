/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useRef, useState, useCallback } from 'react'

export interface RecorderAudioChunk extends Record<string, unknown> {
  type: 'user'
  data: string
  timestamp: string
}

interface UseRecorderOptions {
  mode?: 'stream' | 'utterance'
  onAudioChunk?: (base64: string) => void
  onRecordingComplete?: (audio: RecorderAudioChunk[]) => void | Promise<void>
}

const audioProcessorCode = `
class AudioRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.recording = false
    this.buffer = []
    this.port.onmessage = e => {
      if (e.data.command === 'START') this.recording = true
      else if (e.data.command === 'STOP') {
        this.recording = false
        if (this.buffer.length) this.sendBuffer()
      }
    }
  }
  sendBuffer() {
    if (this.buffer.length) {
      this.port.postMessage({
        eventType: 'audio',
        audioData: new Float32Array(this.buffer)
      })
      this.buffer = []
    }
  }
  process(inputs) {
    if (inputs[0]?.length && this.recording) {
      this.buffer.push(...inputs[0][0])
      if (this.buffer.length >= 2400) this.sendBuffer()
    }
    return true
  }
}
registerProcessor('audio-recorder', AudioRecorderProcessor)
`

export function useRecorder({
  mode = 'stream',
  onAudioChunk,
  onRecordingComplete,
}: UseRecorderOptions = {}) {
  const [recording, setRecording] = useState(false)
  const [inputLevel, setInputLevel] = useState(0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const workletRef = useRef<AudioWorkletNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const levelRafRef = useRef<number | null>(null)
  const audioRecording = useRef<RecorderAudioChunk[]>([])

  const initAudio = useCallback(async () => {
    if (audioCtxRef.current) return

    const audioCtx = new AudioContext({ sampleRate: 24000 })
    const blob = new Blob([audioProcessorCode], {
      type: 'application/javascript',
    })
    const url = URL.createObjectURL(blob)
    await audioCtx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    audioCtxRef.current = audioCtx
  }, [])

  const startRecording = useCallback(async () => {
    await initAudio()
    const audioCtx = audioCtxRef.current

    if (!audioCtx) return

    if (mode === 'utterance' || onRecordingComplete) {
      audioRecording.current = []
    }

    if (audioCtx.state === 'suspended') {
      await audioCtx.resume()
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 24000,
        echoCancellation: true,
      },
    })

    const source = audioCtx.createMediaStreamSource(stream)
    const worklet = new AudioWorkletNode(audioCtx, 'audio-recorder')
    streamRef.current = stream
    sourceRef.current = source

    worklet.port.onmessage = e => {
      if (e.data.eventType === 'audio') {
        const float32 = e.data.audioData
        const int16 = new Int16Array(float32.length)
        for (let i = 0; i < float32.length; i++) {
          int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32767))
        }
        const base64 = btoa(
          String.fromCharCode(...new Uint8Array(int16.buffer))
        )
        audioRecording.current.push({
          type: 'user',
          data: base64,
          timestamp: new Date().toISOString(),
        })
        if (mode === 'stream') {
          onAudioChunk?.(base64)
        }
      }
    }

    source.connect(worklet)
    worklet.connect(audioCtx.destination)
    worklet.port.postMessage({ command: 'START' })

    // Branch: source -> analyser (for RMS input level visualisation).
    // Kept separate from the worklet graph so it never affects capture.
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.6
    source.connect(analyser)
    analyserRef.current = analyser

    const timeBuffer = new Float32Array(analyser.fftSize)
    const tick = () => {
      const node = analyserRef.current
      if (!node) return
      node.getFloatTimeDomainData(timeBuffer)
      let sumSquares = 0
      for (let i = 0; i < timeBuffer.length; i++) {
        const v = timeBuffer[i]
        sumSquares += v * v
      }
      const rms = Math.sqrt(sumSquares / timeBuffer.length)
      // Normalise: rms is in [0, 1] for float32 PCM but typical speech
      // peaks around 0.2–0.4, so scale for a responsive orb.
      const normalised = Math.min(1, rms * 3)
      setInputLevel(normalised)
      levelRafRef.current = requestAnimationFrame(tick)
    }
    levelRafRef.current = requestAnimationFrame(tick)

    workletRef.current = worklet
    setRecording(true)
  }, [initAudio, mode, onAudioChunk, onRecordingComplete])

  const stopRecording = useCallback(async () => {
    if (workletRef.current) {
      workletRef.current.port.postMessage({ command: 'STOP' })
      await new Promise(resolve => window.setTimeout(resolve, 60))
      workletRef.current.disconnect()
      workletRef.current = null
    }

    if (levelRafRef.current !== null) {
      cancelAnimationFrame(levelRafRef.current)
      levelRafRef.current = null
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect()
      analyserRef.current = null
    }
    setInputLevel(0)

    sourceRef.current?.disconnect()
    sourceRef.current = null
    const mediaStream = streamRef.current
    if (mediaStream) {
      for (const track of mediaStream.getTracks()) {
        track.stop()
      }
    }
    streamRef.current = null

    setRecording(false)

    const completedAudio =
      mode === 'utterance' || onRecordingComplete
        ? [...audioRecording.current]
        : undefined

    if (completedAudio?.length && onRecordingComplete) {
      await onRecordingComplete(completedAudio)
      audioRecording.current = []
    }
  }, [mode, onRecordingComplete])

  const toggleRecording = useCallback(async () => {
    if (recording) {
      await stopRecording()
    } else {
      await startRecording()
    }
  }, [recording, startRecording, stopRecording])

  const getAudioRecording = useCallback(() => audioRecording.current, [])
  const clearAudioRecording = useCallback(() => {
    audioRecording.current = []
  }, [])

  return {
    recording,
    inputLevel,
    toggleRecording,
    getAudioRecording,
    clearAudioRecording,
  }
}
