'use client'

import React, { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function DatabaseStatusPill() {
  const [status, setStatus] = useState<'CONNECTED' | 'OFFLINE'>('OFFLINE')

  useEffect(() => {
    const supabase = createClient()

    async function checkHealth() {
      try {
        const { error } = await supabase.from('system_audit_logs').select('id').limit(1)
        if (!error) {
          setStatus('CONNECTED')
        } else {
          setStatus('OFFLINE')
        }
      } catch {
        setStatus('OFFLINE')
      }
    }

    checkHealth()

    // Realtime channel listener to keep connection status active
    const channel = supabase
      .channel('system_audit_logs_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'system_audit_logs' },
        () => {
          setStatus('CONNECTED')
        }
      )
      .subscribe((statusResponse) => {
        if (statusResponse === 'SUBSCRIBED') {
          setStatus('CONNECTED')
        } else if (statusResponse === 'CLOSED' || statusResponse === 'CHANNEL_ERROR') {
          setStatus('OFFLINE')
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const isConnected = status === 'CONNECTED'

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '9999px',
        fontSize: '12px',
        fontWeight: 600,
        backgroundColor: isConnected ? '#10B98120' : '#F43F5E20',
        color: isConnected ? '#10B981' : '#F43F5E',
        border: `1px solid ${isConnected ? '#10B98140' : '#F43F5E40'}`,
        transition: 'all 0.2s ease',
      }}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: isConnected ? '#10B981' : '#F43F5E',
        }}
      />
      [{status}]
    </div>
  )
}
