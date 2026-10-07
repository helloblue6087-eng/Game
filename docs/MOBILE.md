# Mobile

The console is designed phone-first and widened for desktop — not the other way
round.

## Layout

| Width | Shell |
| --- | --- |
| < 640 px | Compact 52 px top bar + 5-slot bottom navigation + full-height content |
| 640–1023 px | Same shell; grids expand to 2–4 columns |
| ≥ 1024 px | Fixed 256 px sidebar with the full navigation tree; main column widens to 1024 px |

Bottom navigation slots (never more than five, so no slot is under ~70 px wide):
**Home · Agent · Terminal · PC · More**. Everything else lives behind More,
mirroring the sidebar so nothing is desktop-only.

## Untouched by design

- No horizontal scrolling on any page. Wide content (tables, log lines, command
  blocks) scrolls inside its own container, never the page.
- Interactive targets are ≥ 40 px; primary buttons are ~44 px tall.
- `env(safe-area-inset-bottom)` is applied to the bottom bar and sheets so the
  home indicator never overlaps a tap target.
- The viewport is locked to `maximum-scale=1` to prevent iOS zoom-on-focus
  jumping the layout, with `viewport-fit=cover` for notch devices.
- Headers stay ~52 px tall; no oversized hero inside the console.

## Terminal

- Dedicated fullscreen toggle (`expand` icon) that lifts the terminal to a fixed
  overlay covering the whole viewport.
- Input is captured on a real `<input>` with `autocapitalize="off"`,
  `autocorrect="off"`, `spellcheck="false"`, so the phone's own keyboard, IME and
  predictive text behave natively.
- Keys map to PTY control sequences: Enter → `\r`, Backspace → `\u007f`,
  Tab → `\t`, arrows → `ESC [A/B/C/D`, Ctrl-C → `\u0003`, Ctrl-D → `\u0004`.
- Tapping anywhere in the output re-focuses the hidden input, so the keyboard
  comes back without a dedicated "type" button.

## Agent chat

- The message list and composer occupy the viewport height; the composer is
  pinned just above the bottom navigation (`bottom-[70px]`, `lg:bottom-0`).
- The composer auto-sizes up to 160 px, then scrolls internally.
- Approval banners render **inline, directly above the composer**, so the verdict
  is one tap away while you are reading the explanation that prompted it.
- The session bar is a single compact row that collapses the long provider/model
  string with `truncate`.

## Sheets, not modals

On phones every secondary surface is a bottom sheet (rounded top, drag-free
tap-out to dismiss, `max-h-[85vh]` / `92vh`) that becomes a centred dialog at
`sm:`. This keeps controls in thumb reach instead of at the top of the screen.

## Performance on a phone

- One metrics stream at a configurable interval (1 s / 2 s / 5 s) rather than
  per-widget polling; history is capped at 90 samples.
- Terminal buffers are capped at 200 KB per terminal; the logs ring buffer at
  1500 entries. Both are trimmed on write.
- Log rendering slices to the most recent 400 rows.
- Seven independent stores mean a metrics sample never re-renders the chat, and
  a terminal keystroke never re-renders the dashboard.
- Charts are hand-rolled SVG (a sparkline and CSS bars) — no charting library.
- Fonts are limited to two families with `display=swap`, and motion is limited to
  a caret, a pulse ring and short fades.
