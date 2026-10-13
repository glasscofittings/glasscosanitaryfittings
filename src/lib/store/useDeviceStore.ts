import { create } from "zustand";
import { getHardwareNodeId } from "@/lib/tauri-bridge";

interface DeviceState {
  nodeId: string;
  setNodeId: (id: string) => void;
  fetchNodeId: () => Promise<void>;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  nodeId: "WEB-NODE",
  setNodeId: (id) => set({ nodeId: id }),
  fetchNodeId: async () => {
    const id = await getHardwareNodeId();
    set({ nodeId: id });
  },
}));
