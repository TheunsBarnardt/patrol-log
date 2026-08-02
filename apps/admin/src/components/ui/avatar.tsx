import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Avatar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative flex h-9 w-9 shrink-0 overflow-hidden rounded-full bg-[#dfe5e7] text-[#54656f]",
        className,
      )}
      {...props}
    />
  );
}

export function AvatarFallback({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("flex h-full w-full items-center justify-center text-xs font-semibold uppercase", className)}
      {...props}
    />
  );
}
