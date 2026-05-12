# wordart — deferred features

Tracked in-repo so they don't get lost in chat.

## Multi-line text input

**Status:** deferred.

Every effect today binds to a single `<input type="text">` (see
`shared/gui.js` `_bindText`). A `\n` in the phrase collapses to a single line
because the input element itself can't hold a newline. None of the eight
canvases lay out multi-line phrases.

**What it would take:**

1. Swap `input[type=text]` for a one-row `<textarea>` (or a `contenteditable`)
   in `_bindText`, preserving the shuffle and submit affordances.
2. Decide per-effect whether `\n` means a hard line break or a visual gap.
   Line / type / mesh have obvious multi-line semantics. Halftone / dither /
   glitch render the phrase as a bitmap and need a layout pass before raster.
3. Re-tune the auto-fit sizing so two short lines don't blow past the canvas
   bounds the way one long line currently does.
4. Decide how the keyboard splash documents it (probably `Shift+Enter` for
   newline, `Enter` to commit, to match common form ergonomics).

Not blocking anything. Surfaces every few months when someone tries to type
a two-line phrase.
