import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Bubble({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("relative max-w-[min(100%,28rem)]", className)} {...props} />;
}

export function BubbleContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg px-3 py-2 text-[14.2px] leading-[19px] shadow-sm whitespace-pre-wrap break-words",
        className,
      )}
      {...props}
    />
  );
}
