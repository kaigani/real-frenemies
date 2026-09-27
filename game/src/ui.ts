/**
 * Immediate-mode widgets on the pixel canvas. Each frame registers its widgets; input between frames is resolved
 * against the last frame's list. Tab / Shift+Tab walk focus, Enter / Space activate, arrows go to the focused
 * widget first (board cursor, roster) and otherwise move focus.
 */
export type Widget = {
  id: string; x: number; y: number; w: number; h: number; label: string;
  disabled?: boolean;
  activate?: () => void;
  /** Pointer press at native coordinates inside the widget. Defaults to activate(). */
  press?: (x: number, y: number) => void;
  /** Return true if the arrow was consumed. */
  arrow?: (dx: number, dy: number) => boolean;
};

export class Ui {
  widgets: Widget[] = [];
  private previous: Widget[] = [];
  focusId: string | null = null;
  keyboard = false;

  begin() { this.previous = this.widgets; this.widgets = []; }

  add(widget: Widget) { this.widgets.push(widget); return widget; }

  focused(id: string) { return this.keyboard && this.focusId === id; }

  private list() { return this.widgets.length ? this.widgets : this.previous; }

  private focusables() { return this.list().filter(w => !w.disabled); }

  current() { return this.list().find(w => w.id === this.focusId && !w.disabled) ?? null; }

  /** Move focus; returns false when stepping past either end so Tab can leave the canvas (no keyboard trap). */
  step(dir: 1 | -1) {
    const list = this.focusables();
    if (!list.length) return false;
    const i = list.findIndex(w => w.id === this.focusId);
    const next = i < 0 ? (dir > 0 ? 0 : list.length - 1) : i + dir;
    if (next < 0 || next >= list.length) { this.focusId = null; this.keyboard = false; return false; }
    this.focusId = list[next].id;
    this.keyboard = true;
    return true;
  }

  focus(id: string) { this.focusId = id; }

  activate() {
    const w = this.current();
    if (w?.activate) w.activate();
    else if (!w) this.step(1);
  }

  arrow(dx: number, dy: number) {
    this.keyboard = true;
    const w = this.current();
    if (w?.arrow?.(dx, dy)) return;
    const list = this.focusables();
    if (!list.length) return;
    const i = list.findIndex(x => x.id === this.focusId);
    this.focusId = list[(i + (dx + dy > 0 ? 1 : -1) + list.length) % list.length].id;
  }

  press(x: number, y: number) {
    this.keyboard = false;
    const list = this.list();
    for (let i = list.length - 1; i >= 0; i--) {
      const w = list[i];
      if (x >= w.x && y >= w.y && x < w.x + w.w && y < w.y + w.h) {
        if (w.disabled) return true;
        this.focusId = w.id;
        if (w.press) w.press(x, y); else w.activate?.();
        return true;
      }
    }
    return false;
  }

  /** Keep focus valid after a screen change. */
  settle(preferred?: string) {
    const list = this.focusables();
    if (this.focusId !== null && !list.some(w => w.id === this.focusId)) this.focusId = null;
    if (this.focusId === null && preferred && list.some(w => w.id === preferred)) this.focusId = preferred;
  }
}
