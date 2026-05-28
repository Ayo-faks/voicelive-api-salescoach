import { useCallback, useEffect, useRef, useState } from 'react'

export function useTtsPlayer(): {
  supported: boolean
  playing: boolean
  play: (text: string) => Promise<void>
  stop: () => void
} {
  const [supported, setSupported] = useState(true)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  const revokeObjectUrl = useCallback(() => {
    if (!objectUrlRef.current) return
    URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
  }, [])

  const stop = useCallback(() => {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
    }
    revokeObjectUrl()
    setPlaying(false)
  }, [revokeObjectUrl])

  useEffect(() => {
    const audio = new Audio()
    audioRef.current = audio
    const handlePlay = () => setPlaying(true)
    const handlePause = () => setPlaying(false)
    const handleEnded = () => {
      revokeObjectUrl()
      setPlaying(false)
    }
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)
    return () => {
      audio.pause()
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
      audioRef.current = null
      revokeObjectUrl()
    }
  }, [revokeObjectUrl])

  const play = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || !supported) return
    const audio = audioRef.current
    if (!audio) return
    stop()
    const response = await fetch('/api/learning/tts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed }),
    })
    if (response.status === 503) {
      setSupported(false)
      return
    }
    if (!response.ok) return
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    objectUrlRef.current = objectUrl
    audio.src = objectUrl
    try {
      setPlaying(true)
      await audio.play()
    } catch {
      revokeObjectUrl()
      setPlaying(false)
    }
  }, [revokeObjectUrl, stop, supported])

  return { supported, playing, play, stop }
}
