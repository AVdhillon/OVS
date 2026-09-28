"use client";

import * as React from "react";

import { cn } from "./utils";

/**
 * Below `md` every row is restyled as a card (see the "Table → card" block in
 * styles/index.css). To do that without touching ~10 call sites, this walks the
 * table and tags each cell with:
 *
 *   data-label  the column name (shown beside the value on phones)
 *   data-kind   primary | field | select | aux | actions | detail | empty
 *   data-first  the first cell that flows in the card body (no top hairline)
 *
 * and each row with data-kind="detail" | "empty" when it is a full-width row.
 * Only attributes are written, and the observer watches childList only, so it
 * can't re-trigger itself.
 */
const FORM_CONTROLS = "input, textarea, select, [role='combobox']";

function setAttr(el: Element, name: string, value: string | null) {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

function applyColumnLabels(table: HTMLTableElement) {
  const headRow = table.tHead?.rows[0];
  if (!headRow) return;
  const labels = Array.from(headRow.cells).map(
    (th) => th.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );
  for (const body of Array.from(table.tBodies)) {
    let prevWasDataRow = false;
    for (const row of Array.from(body.rows)) {
      const cells = Array.from(row.cells);
      const isFullWidth = cells.length > 0 && cells.every((c) => c.colSpan > 1);

      if (isFullWidth) {
        // An expanded-detail row belongs to the card above it; a lone
        // full-width row (no data row before it) is an empty state.
        const kind = prevWasDataRow ? "detail" : "empty";
        setAttr(row, "data-kind", kind);
        for (const cell of cells) {
          setAttr(cell, "data-kind", kind);
          setAttr(cell, "data-label", null);
          setAttr(cell, "data-first", null);
        }
        if (kind === "empty") prevWasDataRow = false;
        continue;
      }

      setAttr(row, "data-kind", null);
      prevWasDataRow = true;

      let col = 0;
      let primaryTaken = false;
      let firstFlowTaken = false;
      for (const cell of cells) {
        const label = labels[col] ?? "";
        col += cell.colSpan;
        setAttr(cell, "data-label", label);

        let kind: string;
        if (!label) {
          kind = cell.querySelector("[role='checkbox']") ? "select" : "aux";
        } else if (/^actions?$/i.test(label)) {
          kind = "actions";
        } else if (!primaryTaken && !cell.querySelector(FORM_CONTROLS)) {
          // First readable column becomes the card title.
          kind = "primary";
          primaryTaken = true;
        } else {
          kind = "field";
          primaryTaken = true; // a form control as first column = no title
        }
        setAttr(cell, "data-kind", kind);

        const flows = kind === "primary" || kind === "field";
        if (flows && !firstFlowTaken) {
          firstFlowTaken = true;
          setAttr(cell, "data-first", "true");
        } else {
          setAttr(cell, "data-first", null);
        }
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
          "w-full caption-bottom text-sm max-md:block max-md:min-w-0",
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
        "md:[&_tr:last-child]:border-0 max-md:flex max-md:flex-col max-md:gap-3",
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
        // Card on phones (layout details live in styles/index.css).
        "max-md:relative max-md:block max-md:rounded-xl max-md:border max-md:overflow-hidden",
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

function TableCell({
  className,
  children,
  ...props
}: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "md:p-2 md:whitespace-nowrap align-middle md:[&:has([role=checkbox])]:pr-0 md:[&_[role=checkbox]]:translate-y-[2px]",
        className,
      )}
      {...props}
    >
      {/* Wrapper is `display: contents` on desktop (no layout change) and the
          value column on phones, so multi-node values (text + badge, several
          buttons) stay together next to the label. */}
      <div data-slot="table-cell-value">{children}</div>
    </td>
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
