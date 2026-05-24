import { useCallback, useEffect, useState } from 'react'
import {
  getStudentProfile,
  overrideStudentMastery,
  type OverrideMasteryResponse,
  type StudentProfileResponse,
} from './api'

type UseStudentProfileOptions = {
  tenantId?: string
  actorId?: string
  enabled?: boolean
}

export function useStudentProfile(
  studentId: string | null,
  options: UseStudentProfileOptions = {}
) {
  const { tenantId, actorId, enabled = true } = options
  const [profile, setProfile] = useState<StudentProfileResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    if (!studentId || !enabled) {
      setProfile(null)
      return null
    }
    setLoading(true)
    setError(null)
    try {
      const next = await getStudentProfile(studentId, {
        tenant_id: tenantId,
        actor_id: actorId,
      })
      setProfile(next)
      return next
    } catch (err) {
      const nextError = err instanceof Error ? err : new Error(String(err))
      setError(nextError)
      return null
    } finally {
      setLoading(false)
    }
  }, [actorId, enabled, studentId, tenantId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const overrideMastery = useCallback(
    async (payload: {
      skill_id: string
      probability: number
      uncertainty?: number
      reason: string
    }): Promise<OverrideMasteryResponse> => {
      if (!studentId) throw new Error('student id required')
      const result = await overrideStudentMastery(studentId, {
        ...payload,
        tenant_id: tenantId,
        actor_id: actorId,
      })
      await refresh()
      return result
    },
    [actorId, refresh, studentId, tenantId]
  )

  return {
    profile,
    loading,
    error,
    refresh,
    mutate: refresh,
    overrideMastery,
  }
}
