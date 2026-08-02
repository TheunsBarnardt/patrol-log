import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type Align = "start" | "end";

export function Message({
  align = "start",
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { align?: Align }) {
  return (
    <div
      data-align={align}
      className={cn(
        "group/message flex w-full items-end gap-2",
        align === "end" && "flex-row-reverse",
        className,
      )}
      {...props}
    />
  );
}

export function MessageGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-0.5", className)} {...props} />;
}

export function MessageAvatar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-0.5 shrink-0", className)} {...props} />;
}

export function MessageContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-w-0 max-w-[85%] flex-col gap-1",
        "group-data-[align=end]/message:items-end",
        className,
      )}
      {...props}
    />
  );
}

export function MessageHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-1 text-[12.5px] font-medium text-[#667781]", className)} {...props} />;
}

export function MessageFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 px-1 text-[11px] text-[#667781]",
        "group-data-[align=end]/message:justify-end",
        className,
      )}
      {...props}
    />
  );
}
