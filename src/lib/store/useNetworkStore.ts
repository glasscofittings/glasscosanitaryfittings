import { create } from "zustand";

type RealtimeStatus = "CONNECTING" | "SUBSCRIBED" | "CLOSED" | "CHANNEL_ERROR" | "TIMED_OUT";

interface NetworkState {
  isOnline: boolean;
  isBrowserOnline: boolean;
  realtimeStatus: RealtimeStatus;
  setBrowserOnline: (val: boolean) => void;
  setRealtimeStatus: (status: RealtimeStatus) => void;
  isConnected: () => boolean;
}

export const useNetworkStore = create<NetworkState>((set, get) => ({
  isOnline: true,
  isBrowserOnline: true,
  realtimeStatus: "CONNECTING",

  setBrowserOnline: (val) => set((state) => ({ isBrowserOnline: val, isOnline: val && state.realtimeStatus === "SUBSCRIBED" })),
  setRealtimeStatus: (status) => set((state) => ({ realtimeStatus: status, isOnline: state.isBrowserOnline && status === "SUBSCRIBED" })),

  isConnected: () => {
    const s = get();
    return s.isBrowserOnline && s.realtimeStatus === "SUBSCRIBED";
  },
}));
