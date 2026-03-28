/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useRef, useCallback, useEffect } from 'react'

type RTCIceServerInput =
  | string
  | RTCIceServer

type RTCAnswerMessage = {
  server_sdp?: unknown
  sdp?: unknown
  answer?: unknown
}

function normalizeIceServers(
  iceServers: RTCIceServerInput | RTCIceServerInput[],
  username?: string,
  password?: string
): RTCIceServer[] {
  const normalized = (Array.isArray(iceServers) ? iceServers : [iceServers]).map(server =>
    typeof server === 'string'
      ? { urls: server }
      : {
          ...server,
          urls: server.urls,
        }
  )

  if (!username || !password) {
    return normalized
  }

  return normalized.map(server => ({
    ...server,
    username,
    credential: password,
    credentialType: 'password',
  }))
}

export function useWebRTC(
  onSendOffer: (sdp: string) => void,
  onVideoStreamReady?: () => void
) {
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const teardownPeerConnection = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.onicecandidate = null
      pcRef.current.ontrack = null
      pcRef.current.close()
      pcRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  const setupWebRTC = useCallback(
    async (
      iceServers: RTCIceServerInput | RTCIceServerInput[],
      username?: string,
      password?: string
    ) => {
      teardownPeerConnection()

      const pc = new RTCPeerConnection({
        iceServers: normalizeIceServers(iceServers, username, password),
        bundlePolicy: 'max-bundle',
      })

      pc.onicecandidate = e => {
        if (!e.candidate && pc.localDescription) {
          const sdp = btoa(
            JSON.stringify({
              type: 'offer',
              sdp: pc.localDescription.sdp,
            })
          )
          onSendOffer(sdp)
        }
      }

      pc.ontrack = e => {
        if (e.track.kind === 'video' && videoRef.current) {
          videoRef.current.srcObject = e.streams[0]
          onVideoStreamReady?.()
          videoRef.current.play()
        } else if (e.track.kind === 'audio') {
          const audio = document.createElement('audio')
          audio.srcObject = e.streams[0]
          audio.autoplay = true
          audio.style.display = 'none'
          document.body.appendChild(audio)
        }
      }

      pc.addTransceiver('video', { direction: 'recvonly' })
      pc.addTransceiver('audio', { direction: 'recvonly' })

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      pcRef.current = pc
    },
    [onSendOffer, onVideoStreamReady, teardownPeerConnection]
  )

  const handleAnswer = useCallback(async (msg: RTCAnswerMessage) => {
    if (!pcRef.current || pcRef.current.signalingState !== 'have-local-offer')
      return

    const encodedServerSdp =
      typeof msg.server_sdp === 'string' ? msg.server_sdp : null
    const directSdp =
      typeof msg.sdp === 'string'
        ? msg.sdp
        : typeof msg.answer === 'string'
          ? msg.answer
          : null
    const sdp = encodedServerSdp
      ? JSON.parse(atob(encodedServerSdp)).sdp
      : directSdp

    if (typeof sdp === 'string' && sdp) {
      await pcRef.current.setRemoteDescription({ type: 'answer', sdp })
    }
  }, [])

  useEffect(() => {
    return () => {
      teardownPeerConnection()
    }
  }, [teardownPeerConnection])

  return {
    setupWebRTC,
    handleAnswer,
    videoRef,
  }
}
