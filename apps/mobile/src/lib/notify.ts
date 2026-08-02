import { useDialogStore, type DialogAction } from "../store/dialog";

/** In-app message box (replaces window.alert / RN Alert). */
export function notify(title: string, message?: string, actions?: DialogAction[]): void {
  useDialogStore.getState().show({ title, message, actions });
}

/** Confirm dialog — resolves true if the confirm action is pressed. */
export function confirm(
  title: string,
  message?: string,
  opts?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().show({
      title,
      message,
      actions: [
        {
          label: opts?.cancelLabel ?? "Cancel",
          variant: "ghost",
          onPress: () => resolve(false),
        },
        {
          label: opts?.confirmLabel ?? "OK",
          variant: opts?.danger ? "danger" : "primary",
          onPress: () => resolve(true),
        },
      ],
    });
  });
}
