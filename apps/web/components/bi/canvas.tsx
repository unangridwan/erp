"use client";

import { canvasRows, CANVAS_COLUMNS, moveItem, resizeItem, type BiLayout, type BiVisual } from "@erp/shared";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useI18n } from "../../lib/i18n";

const ROW = 44;
const GAP = 12;
/** Di bawah lebar ini kanvas ditumpuk satu kolom (ponsel). */
const STACK_BELOW = 640;

interface Drag {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  layout: BiLayout;
  dx: number;
  dy: number;
}

/**
 * Kanvas grid 12 kolom. Mode ubah: seret judul untuk memindah, seret sudut kanan bawah untuk mengubah ukuran
 * (visual lain terdorong & memadat); keyboard: panah = pindah, Shift+panah = ubah ukuran, Delete = hapus.
 */
export function Canvas({
  visuals,
  editing,
  selected,
  onSelect,
  onLayout,
  onDelete,
  renderHeader,
  renderBody,
}: {
  visuals: BiVisual[];
  editing: boolean;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  onLayout?: (visuals: BiVisual[]) => void;
  onDelete?: (id: string) => void;
  renderHeader: (v: BiVisual) => ReactNode;
  renderBody: (v: BiVisual) => ReactNode;
}) {
  const { l } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [drag, setDrag] = useState<Drag | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stacked = width < STACK_BELOW;
  const colW = (width - GAP * (CANVAS_COLUMNS - 1)) / CANVAS_COLUMNS;
  const cellX = colW + GAP;
  const cellY = ROW + GAP;

  // Tata letak pratinjau selama menyeret (visual lain menyesuaikan).
  const preview = (() => {
    if (!drag) return visuals;
    const dCol = Math.round(drag.dx / cellX);
    const dRow = Math.round(drag.dy / cellY);
    return drag.mode === "move"
      ? moveItem(visuals, drag.id, drag.layout.x + dCol, drag.layout.y + dRow)
      : resizeItem(visuals, drag.id, drag.layout.w + dCol, drag.layout.h + dRow);
  })();

  const start = (v: BiVisual, mode: Drag["mode"]) => (e: PointerEvent) => {
    if (!editing || stacked || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onSelect?.(v.id);
    setDrag({ id: v.id, mode, startX: e.clientX, startY: e.clientY, layout: v.layout, dx: 0, dy: 0 });
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    setDrag({ ...drag, dx: e.clientX - drag.startX, dy: e.clientY - drag.startY });
  };
  const end = () => {
    if (!drag) return;
    const changed = preview.some((p) => {
      const o = visuals.find((v) => v.id === p.id)!;
      return (
        o.layout.x !== p.layout.x ||
        o.layout.y !== p.layout.y ||
        o.layout.w !== p.layout.w ||
        o.layout.h !== p.layout.h
      );
    });
    setDrag(null);
    if (changed) onLayout?.(preview);
  };

  const keyDown = (v: BiVisual) => (e: KeyboardEvent) => {
    if (!editing || e.target !== e.currentTarget) return;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onDelete?.(v.id);
      return;
    }
    const d = step[e.key];
    if (!d) return;
    e.preventDefault();
    onLayout?.(
      e.shiftKey
        ? resizeItem(visuals, v.id, v.layout.w + d[0], v.layout.h + d[1])
        : moveItem(visuals, v.id, v.layout.x + d[0], v.layout.y + d[1]),
    );
  };

  const rows = canvasRows(preview);
  const ordered = stacked
    ? [...visuals].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)
    : visuals;

  return (
    <div
      ref={ref}
      className={`bi-canvas${editing ? " editing" : ""}${stacked ? " stacked" : ""}`}
      style={stacked ? undefined : { height: Math.max(rows, editing ? 8 : 1) * cellY }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelect?.(null);
      }}
    >
      {editing && !stacked && (
        <div
          className="bi-canvas-grid"
          aria-hidden="true"
          style={{ backgroundSize: `${cellX}px ${cellY}px` }}
        />
      )}
      {ordered.map((v) => {
        const p = preview.find((x) => x.id === v.id)!.layout;
        const dragging = drag?.id === v.id;
        const box = dragging && drag.mode === "move" ? drag.layout : p;
        const style = stacked
          ? { minHeight: Math.max(3, v.layout.h) * ROW * (v.type === "card" || v.type === "kpi" ? 0.6 : 0.8) }
          : {
              left: box.x * cellX,
              top: box.y * cellY,
              width: (dragging && drag.mode === "resize" ? p.w : box.w) * cellX - GAP,
              height: (dragging && drag.mode === "resize" ? p.h : box.h) * cellY - GAP,
              ...(dragging && drag.mode === "move"
                ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` }
                : {}),
            };
        return (
          <section
            key={v.id}
            className={`bi-visual type-${v.type}${selected === v.id ? " selected" : ""}${dragging ? " dragging" : ""}`}
            style={style}
            data-visual={v.id}
            tabIndex={editing ? 0 : undefined}
            aria-label={
              editing
                ? `${v.title || v.type} — ${l("panah untuk memindah, Shift+panah untuk mengubah ukuran", "arrows to move, Shift+arrows to resize")}`
                : undefined
            }
            onKeyDown={keyDown(v)}
            onClick={editing ? () => onSelect?.(v.id) : undefined}
          >
            <header
              onPointerDown={start(v, "move")}
              className={editing && !stacked ? "drag-handle" : undefined}
            >
              {renderHeader(v)}
            </header>
            <div className="bi-visual-body">{renderBody(v)}</div>
            {editing && !stacked && (
              <span
                className="bi-resize"
                role="presentation"
                title={l("Seret untuk mengubah ukuran", "Drag to resize")}
                onPointerDown={start(v, "resize")}
              />
            )}
          </section>
        );
      })}
      {dragging(drag) && drag && drag.mode === "move" && !stacked && (
        <div
          className="bi-drop-ghost"
          style={(() => {
            const p = preview.find((x) => x.id === drag.id)!.layout;
            return {
              left: p.x * cellX,
              top: p.y * cellY,
              width: p.w * cellX - GAP,
              height: p.h * cellY - GAP,
            };
          })()}
        />
      )}
    </div>
  );
}

const dragging = (d: Drag | null) => !!d;
