import { Skeleton } from "./ui/skeleton";

/**
 * Shared skeleton placeholders used instead of plain "Loading…" text.
 * They mirror the shape of what will load (list rows, detail blocks, chart)
 * so the page doesn't jump when data arrives.
 */

/** Stack of row-shaped placeholders — for tables and card lists. */
export function ListSkeleton({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className={className ?? "space-y-3 py-2"}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-lg border p-3"
        >
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="hidden h-6 w-20 sm:block" />
          <Skeleton className="hidden h-4 w-24 md:block" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a detail page body: a few stacked cards' worth of lines. */
export function DetailSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="space-y-4 py-2"
    >
      <Skeleton className="h-8 w-1/2" />
      <div className="space-y-3 rounded-lg border p-4">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      <div className="space-y-3 rounded-lg border p-4">
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    </div>
  );
}

/** Placeholder for a chart area. */
export function ChartSkeleton() {
  const heights = [40, 65, 50, 80, 55, 90, 70, 60];
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="flex h-56 items-end gap-3 py-4"
    >
      {heights.map((h, i) => (
        <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

/** Full-screen placeholder shown while the session is being resolved. */
export function PageSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="mx-auto flex h-dvh w-full max-w-3xl flex-col gap-4 p-6"
    >
      <Skeleton className="h-10 w-1/3" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
