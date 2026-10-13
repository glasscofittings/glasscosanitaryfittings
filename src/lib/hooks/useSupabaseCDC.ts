"use client";

import { useEffect, useRef, useCallback } from "react";
import { useNetworkStore } from "@/lib/store/useNetworkStore";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function getRealtimeUrl(): string | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const projectRef = SUPABASE_URL.replace("https://", "").replace(".supabase.co", "");
  return `wss://${projectRef}.supabase.co/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;
}

interface CDCRecord {
  id: string;
  device_node: string;
  operator_name: string;
  action_type: string;
  module: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export function useSupabaseCDC(
  onInsert: (record: CDCRecord) => void
) {
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const setRealtimeStatus = useNetworkStore((s) => s.setRealtimeStatus);

  const cleanup = useCallback(() => {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const url = getRealtimeUrl();
    if (!url) return;

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      cleanup();
      if (!mountedRef.current) return;

      try {
        if (!url) return;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mountedRef.current) return;
          ws.send(JSON.stringify([
            null,
            "1",
            "realtime:public:system_audit_logs",
            "phx_join",
            {
              config: {
                broadcast: { self: false },
                postgres_changes: [
                  { event: "INSERT", schema: "public", table: "system_audit_logs" },
                ],
              },
            },
          ]));
          heartbeatRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify([null, null, "phoenix", "heartbeat", {}]));
            }
          }, 30000);
        };

        ws.onmessage = (event) => {
          if (!mountedRef.current) return;
          try {
            const msg = JSON.parse(event.data);
            const channel = msg[2];
            const event_type = msg[3];

            if (channel === "phx_reply" && msg[4]?.status === "ok") {
              setRealtimeStatus("SUBSCRIBED");
              return;
            }

            if (
              channel === "realtime:public:system_audit_logs" &&
              event_type === "postgres_changes"
            ) {
              const payload = msg[4];
              if (payload?.type === "INSERT" && payload?.record) {
                const r = payload.record;
                onInsert({
                  id: r.id,
                  device_node: r.device_node,
                  operator_name: r.operator_name,
                  action_type: r.action_type,
                  module: r.module_tag ?? r.module,
                  payload: r.payload_after ?? {},
                  created_at: r.created_at,
                });
              }
            }
          } catch {}
        };

        ws.onclose = () => {
          if (!mountedRef.current) return;
          setRealtimeStatus("CLOSED");
          if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
          reconnectTimer = setTimeout(connect, 5000);
        };

        ws.onerror = () => {
          if (!mountedRef.current) return;
          setRealtimeStatus("CHANNEL_ERROR");
          ws.close();
        };
      } catch {
        setRealtimeStatus("CHANNEL_ERROR");
        reconnectTimer = setTimeout(connect, 5000);
      }
    }

    connect();

    return () => {
      mountedRef.current = false;
      cleanup();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [cleanup, onInsert, setRealtimeStatus]);
}
