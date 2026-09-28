"use client";

import * as React from "react";

import { cn } from "./utils";

/**
 * Copies each header cell's text onto the matching body cells as `data-label`,
 * so that below `md` (where rows are restyled as stacked cards) every value can
 * show its column name beside it. Done in the DOM so the ~9 existing tables get
 * the mobile layout without each cell needing a label prop.
 */
function applyColumnLabels(table: HTMLTableElement) {
  const headRow = table.tHead?.rows[0];
  if (!headRow) return;
  const labels = Array.from(headRow.cells).map(
    (th) => th.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      let col = 0;
      for (const cell of Array.from(row.cells)) {
        // Full-width cells (empty states, expanded details) have no column.
        if (cell.colSpan <= 1) {
          const label = labels[col] ?? "";
          if (cell.getAttribute("data-label") !== label) {
            cell.setAttribute("data-label", label);
          }
        }
        col += cell.colSpan;
      }
    }
  }
}

function Table({ className, ...props }: React.ComponentProps<"table">) {
  const ref = React.useRef<HTMLTableElement>(null);

  React.useLayoutEffect(() => {
    const table = ref.current;
    if (!table) return;
    applyColumnLabels(table);
    // Rows can be added/removed by child components (e.g. an expandable row
    // that manages its own state) without <Table> itself re-rendering.
    // Only childList is observed, so setting attributes can't re-trigger this.
    const observer = new MutationObserver(() => applyColumnLabels(table));
    observer.observe(table, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        ref={ref}
        data-slot="table"
        // Below md: drop the table layout so each row becomes a stacked card.
        className={cn(
          "w-full caption-bottom text-sm max-md:block",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      // Column names move next to each value on phones, so hide the header
      // row visually (kept for screen readers).
      className={cn("[&_tr]:border-b max-md:sr-only", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn(
        "[&_tr:last-child]:border-0 max-md:block max-md:space-y-3",
        className,
      )}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-muted/50 border-t font-medium [&>tr]:last:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
        // Card on phones.
        "max-md:block max-md:rounded-lg max-md:border max-md:p-3 max-md:space-y-1.5",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        // Phones: "Label ........ value" line inside the row card.
        "max-md:flex max-md:items-center max-md:justify-between max-md:gap-4 max-md:p-0 max-md:whitespace-normal max-md:text-right max-md:min-h-8",
        "max-md:before:content-[attr(data-label)] max-md:before:shrink-0 max-md:before:text-left max-md:before:text-xs max-md:before:font-medium max-md:before:text-muted-foreground",
        // Full-width cells (empty state, expanded detail) and cells with no
        // value shouldn't render as label/value lines.
        "max-md:[&[colspan]]:block max-md:[&[colspan]]:p-4 max-md:[&[colspan]]:text-left max-md:[&[colspan]]:before:hidden",
        "max-md:empty:hidden",
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
