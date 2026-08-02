import { create } from "zustand";

export type DialogAction = {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "danger" | "ghost";
};

type DialogState = {
  open: boolean;
  title: string;
  message?: string;
  actions: DialogAction[];
  show: (opts: { title: string; message?: string; actions?: DialogAction[] }) => void;
  hide: () => void;
};

export const useDialogStore = create<DialogState>((set) => ({
  open: false,
  title: "",
  message: undefined,
  actions: [{ label: "OK" }],
  show: ({ title, message, actions }) =>
    set({
      open: true,
      title,
      message,
      actions: actions?.length ? actions : [{ label: "OK" }],
    }),
  hide: () => set({ open: false }),
}));
