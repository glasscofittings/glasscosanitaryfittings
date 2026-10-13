import { create } from "zustand";

interface OperatorModalState {
  isOpen: boolean;
  actionLabel: string;
  nonce: number;
  resolve: ((name: string) => void) | null;
  reject: (() => void) | null;
  open: (actionLabel: string) => Promise<string>;
  confirm: (name: string) => void;
  cancel: () => void;
}

export const useOperatorStore = create<OperatorModalState>((set) => ({
  isOpen: false,
  actionLabel: "",
  nonce: 0,
  resolve: null,
  reject: null,

  open: (actionLabel: string) =>
    new Promise<string>((resolve, reject) => {
      set((s) => ({ isOpen: true, actionLabel, nonce: s.nonce + 1, resolve, reject }));
    }),

  confirm: (name: string) => {
    const { resolve } = useOperatorStore.getState();
    resolve?.(name);
    set({ isOpen: false, resolve: null, reject: null, actionLabel: "" });
  },

  cancel: () => {
    const { reject } = useOperatorStore.getState();
    reject?.();
    set({ isOpen: false, resolve: null, reject: null, actionLabel: "" });
  },
}));
