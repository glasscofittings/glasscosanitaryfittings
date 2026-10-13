"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useNetworkStore } from "@/lib/store/useNetworkStore";
import { useDeviceStore } from "@/lib/store/useDeviceStore";
import { createClient } from "@/lib/supabase/client";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const HAS_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function getRealtimeUrl(): string | null {
  if (!HAS_SUPABASE || !SUPABASE_URL) return null;
  const projectRef = SUPABASE_URL.replace("https://", "").replace(".supabase.co", "").replace(/\//g, "");
  return `wss://${projectRef}.supabase.co/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;
}

const CHECK_TIMEOUT_MS = 8000;
const OFFLINE_REASON = "Offline (No Internet Connection)";

/**
 * Map a failed connectivity probe to a short, plain-language reason the client
 * can read off the offline screen and relay to support. Only the labels below
 * are ever shown — raw error text/stacks stay internal (priority order 0 → 10).
 */
function classifyFailure(input: { timedOut: boolean; status: number; message: string; details: string }): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return OFFLINE_REASON;

  const text = `${input.message} ${input.details}`;

  if (input.timedOut || /AbortError|ABORT_ERR|ETIMEDOUT|ERR_CONNECTION_TIMED_OUT/i.test(text)) {
    return "Connection Timed Out (8s)";
  }
  if (input.status === 401 || input.status === 403) return "Authentication or Permission Denied (401/403)";
  if (input.status === 429) return "Rate Limited (429)";
  if (input.status >= 500 && input.status < 600) return "Server Error (5xx)";
  if (input.status >= 400) return `HTTP Error (${input.status})`;
  if (/ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/i.test(text)) return "DNS Resolution Failed";
  if (/ERR_CERT_|ERR_SSL_|handshake/i.test(text)) return "SSL/TLS Certificate Error";
  if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(text)) return "Connection Refused by Server";
  if (/ERR_BLOCKED_BY_|EHOSTUNREACH|ENETUNREACH|ERR_ADDRESS_UNREACHABLE/i.test(text)) return "Network Blocked / Host Unreachable";
  return "Failed to Fetch (Network Block or Offline)";
}

export default function NetworkGuard({ children }: { children: React.ReactNode }) {
  const isBrowserOnline = useNetworkStore((s) => s.isBrowserOnline);
  const realtimeStatus = useNetworkStore((s) => s.realtimeStatus);
  const setBrowserOnline = useNetworkStore((s) => s.setBrowserOnline);
  const setRealtimeStatus = useNetworkStore((s) => s.setRealtimeStatus);
  const nodeId = useDeviceStore((s) => s.nodeId);

  const [restConnected, setRestConnected] = useState<boolean | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  // Suppress offline screen until client has mounted and async checks have run
  const [mounted, setMounted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Perform REST API connection check
  const checkRestConnectivity = useCallback(async (): Promise<boolean> => {
    if (!HAS_SUPABASE) {
      setRestConnected(false);
      setFailureReason(OFFLINE_REASON);
      return false;
    }
    // Fail fast: no retries, and a hard 8s cap so a hung connection surfaces as a timeout
    const timeoutSignal = AbortSignal.timeout(CHECK_TIMEOUT_MS);
    try {
      const supabase = createClient();
      const { error, status } = await supabase
        .from("system_audit_logs")
        .select("id", { count: "exact", head: true })
        .retry(false)
        .abortSignal(timeoutSignal);

      // If no network error occurred, REST is reachable (even if 0 rows or table empty)
      const isOk = !error || error.code === "PGRST116" || error.code === "42P01";
      setRestConnected(isOk);
      setFailureReason(
        isOk
          ? null
          : classifyFailure({
              timedOut: timeoutSignal.aborted,
              status,
              message: error?.message ?? "",
              details: error?.details ?? "",
            })
      );
      return isOk;
    } catch (err) {
      setRestConnected(false);
      setFailureReason(
        classifyFailure({
          timedOut: timeoutSignal.aborted,
          status: 0,
          message: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          details: err instanceof Error ? err.stack ?? "" : "",
        })
      );
      return false;
    }
  }, []);

  const cleanup = useCallback(() => {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
  }, []);

  const doConnect = useCallback(async () => {
    cleanup();
    if (!mountedRef.current) return;

    // Check REST API connectivity first
    await checkRestConnectivity();

    const url = getRealtimeUrl();
    if (!url) {
      setRealtimeStatus("CLOSED");
      return;
    }

    setRealtimeStatus("CONNECTING");

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        ws.send(JSON.stringify([null, "1", "realtime:public:system_audit_logs", "phx_join", {}]));
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
          if (msg[2] === "phx_reply" && msg[3]?.status === "ok") {
            setRealtimeStatus("SUBSCRIBED");
          }
        } catch {}
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setRealtimeStatus("CLOSED");
        if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setRealtimeStatus("CHANNEL_ERROR");
        ws.close();
      };
    } catch {
      setRealtimeStatus("CHANNEL_ERROR");
    }
  }, [checkRestConnectivity, cleanup, setRealtimeStatus]);

  const handleManualRetry = async () => {
    setIsRetrying(true);
    await doConnect();
    setIsRetrying(false);
  };

  useEffect(() => {
    mountedRef.current = true;
    // Deferred: set-state directly in an effect body triggers react-hooks/set-state-in-effect
    queueMicrotask(() => {
      if (mountedRef.current) setMounted(true); // allow offline UI only after client hydration
    });

    function handleOnline() { setBrowserOnline(true); setFailureReason(null); checkRestConnectivity(); }
    function handleOffline() { setBrowserOnline(false); setRestConnected(false); setFailureReason(OFFLINE_REASON); }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    doConnect();

    return () => {
      mountedRef.current = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      cleanup();
    };
  }, [setBrowserOnline, checkRestConnectivity, doConnect, cleanup]);

  // Determine if offline lock screen should be presented:
  // ONLY lock if browser is offline, or if REST ping failed AND realtime is not subscribed.
  // Gated on `mounted` to prevent false lock during SSR / first render tick.
  const isApiReachable = restConnected === true || realtimeStatus === "SUBSCRIBED";
  const showOffline = mounted && (!isBrowserOnline || (HAS_SUPABASE && restConnected === false && !isApiReachable));

  return (
    <div className={showOffline ? "pointer-events-none" : ""}>
      {children}
      {showOffline && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#090B10]/95 backdrop-blur-sm pointer-events-auto">
          <div className="glass-card max-w-md w-full mx-4 p-8 text-center border-status-alert/30">
            <div className="h-12 w-12 rounded-full bg-status-alert/20 flex items-center justify-center mx-auto mb-4">
              <svg className="h-6 w-6 text-status-alert" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <h2 className="text-h1 font-semibold text-status-alert mb-2">SYSTEM OFFLINE</h2>
            <p className="text-body text-secondary mb-2">
              Connection to the server was interrupted.
            </p>
            <p className="text-body text-secondary mb-4">
              To protect your data, all changes on{' '}
              <span className="font-mono font-medium text-foreground">{nodeId}</span>{' '}
              have been paused until the connection is restored.
            </p>
            <div className="mb-6">
              <p className="text-caption text-muted">Current Action: Aborted (No data was altered)</p>
              {failureReason && (
                <p className="text-caption text-muted opacity-75">Reason: {failureReason}</p>
              )}
            </div>

            <button
              onClick={handleManualRetry}
              disabled={isRetrying}
              className="h-9 px-6 rounded-lg bg-[#DC2626] text-white font-medium text-body hover:bg-[#B91C1C] active:bg-[#991B1B] transition-colors inline-flex items-center gap-2 mx-auto disabled:opacity-50"
            >
              <svg className={`h-4 w-4 ${isRetrying ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
              {isRetrying ? 'Checking Connection...' : 'Retry Connection'}
            </button>

            <div className="flex items-center justify-center gap-2 text-caption text-status-amber mt-4">
              <span className="h-1.5 w-1.5 rounded-full bg-status-amber animate-pulse" />
              Attempting Reconnection...
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
