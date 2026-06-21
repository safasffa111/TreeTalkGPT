# Window Control Icon Alignment

This small patch adjusts the frameless window control icon alignment.

## Change

The minimize icon used to be shifted down by `translateY(4px)`, which made it visually lower than the maximize and close icons. It is now shifted by only `translateY(.5px)`, keeping the short horizontal line centered with the other two controls.

## Files

- `frontend/styles.css`

## Notes

No Electron IPC or window behavior was changed. This is a visual-only CSS adjustment.
