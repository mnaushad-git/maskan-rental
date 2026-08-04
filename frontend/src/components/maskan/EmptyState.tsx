import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-5 py-20 text-center", className)}>
      <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="size-7" />
      </div>
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {description && (
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
