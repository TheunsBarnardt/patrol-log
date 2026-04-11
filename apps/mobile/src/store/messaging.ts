import { create } from "zustand";

interface MessagingState {
  unreadCount: number;
  setUnreadCount: (count: number) => void;
}

export const useMessagingStore = create<MessagingState>((set) => ({
  unreadCount: 0,
  setUnreadCount: (count) => set({ unreadCount: count }),
}));
