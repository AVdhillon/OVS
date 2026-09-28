"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, ToasterProps, toast, useSonner } from "sonner";

const TOAST_DURATION = 4000;
// Sonner pauses a toast's own timer while it thinks the toast is hovered /
// being touched / the tab is hidden. In touch emulation (and on real phones)
// the "hover" state can stick, so the toast never leaves. This is a hard
// backstop that dismisses every timed toast regardless of that pause state.

function ToastHardDismiss() {
  const { toasts } = useSonner();
  const timers = useRef(new Map<string | number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const live = new Set(toasts.map((t) => t.id));

    for (const t of toasts) {
      if (timers.current.has(t.id)) continue;
      // Leave loading toasts and explicit persistent ones (duration: Infinity) alone
      if (t.type === "loading" || t.duration === Infinity) continue;
      const ms = (typeof t.duration === "number" ? t.duration : TOAST_DURATION) + 2000;
      timers.current.set(
        t.id,
        setTimeout(() => {
          toast.dismiss(t.id);
          timers.current.delete(t.id);
        }, ms),
      );
    }

    // Forget timers for toasts that are already gone
    for (const [id, timer] of timers.current) {
      if (!live.has(id)) {
        clearTimeout(timer);
        timers.current.delete(id);
      }
    }
  }, [toasts]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current.clear();
    },
    [],
  );

  return null;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <>
      <ToastHardDismiss />
      <Sonner
        theme={theme as ToasterProps["theme"]}
        className="toaster group"
        duration={TOAST_DURATION}
        closeButton
        style={
          {
            "--normal-bg": "var(--popover)",
            "--normal-text": "var(--popover-foreground)",
            "--normal-border": "var(--border)",
          } as React.CSSProperties
        }
        {...props}
      />
    </>
  );
};

export { Toaster };
