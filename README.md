# wordart

Browser-based typography toys. Type a phrase, pick an effect, export it. Eight per-effect canvases share one chrome (panel, theme, keyboard, export).

Live at [toys.iamkesava.com/wordart/](https://toys.iamkesava.com/wordart/).

## Effects

1. **line** — flowing line typography
2. **slice** — horizontal slice displacement
3. **blur** — gaussian + motion blur waves
4. **dither** — ordered dither halftone
5. **type** — kinetic typographic stacks
6. **halftone** — dot-grid halftone
7. **glitch** — RGB-split + scanline glitch
8. **mesh** — warped mesh distortion

## Export

- **PNG** — single frame snapshot of the current canvas.
- **MP4** — 15 second offline render. Frames are encoded one at a time via WebCodecs (`VideoEncoder` → `mp4-muxer`, with webm fallback). The output contains two full pingpong loops and is not a live screen capture, so the file is clean regardless of tab focus or framerate.

## Keyboard

| key | action |
| --- | --- |
| `1`–`8` | switch effect |
| `T` | cycle theme |
| `A` / `Space` | toggle animate |
| `I` | toggle interactive (cursor drives params) |
| `R` | shuffle phrase |
| `P` | export PNG |
| `M` | export 15 s MP4 |
| `C` | collapse / expand panel |
| `?` | show keyboard splash |

## License

MIT. See [LICENSE](LICENSE).
