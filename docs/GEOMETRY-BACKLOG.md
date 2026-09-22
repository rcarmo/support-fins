# Geometry backlog

This backlog is intentionally issue-driven: add or reproduce a fixture first, then change
support generation. Do not tune geometry from a screenshot or a verbal report alone.

## Rules for geometry work

1. Preserve print quality over speed or coverage.
2. Add the failing model/pose/settings as a fixture before changing the algorithm.
3. Record expected counts: generated fins/props, tines, support triangles, served/unserved regions.
4. Run `bun test tests/` after each change; the current local baseline is **94 passed / 0 failed**.
5. If a fix changes output intentionally, update the fixture expectation in the same commit and explain why.

## Active upstream issues to reproduce

### #4 — fins do not reach the bottom of the part for a 15° overhang

**User symptom:** support fins appear too short / do not reach the bed or bottom edge for a shallow overhang.

**Likely area:** wall height/settling, low overhang handling, and the squat/lowledge path.

**Next steps:**

- Obtain or recreate a minimal 15° overhang fixture.
- Add a Bun test that asserts generated support has bed contact and does not float.
- Compare against existing `lowledge` and `squat` tests before changing `PROP.minHeight`, brim, or station sampling.

### #13 — add fins to support tall parts

**User symptom:** users want stability fins/braces for tall, tippy parts, not just overhang supports.

**Product decision:** this is a separate mode from overhang support. Do not overload auto overhang placement.

**Next steps:**

- Define a “stabilize tall print” mode with explicit UI copy.
- Add tall/tippy fixtures with narrow bed contact and no meaningful overhang.
- Score by footprint, height, and point/edge seating rather than overhang area.
- Prefer paired/opposing braces; avoid hidden changes to the user’s part geometry.

### #18 — missed supports on `ssdMounts-Chamfer.stl.zip`

**User symptom:** auto mode misses feet/areas in at least two orientations.

**Likely area:** region splitting, bed-reachability, bore/slot refusal, shallow/curved face classification, or support audit explaining why an area was skipped.

**Next steps:**

- Retrieve the attached `ssdMounts-Chamfer.stl.zip` from the issue and store a minimal repro fixture if license/privacy allows.
- Add one test per reported orientation, with expected served/unserved/skipped counters.
- Use the new support audit text while debugging so skipped reasons are visible.
- Fix classification only after confirming whether the misses are actual failures or intentional refusals.

## Deferred geometry ideas

- Rich overlay for covered/uncovered/blocked/not-bed-reachable regions.
- Branching fins for supports that cannot reach the bed directly.
- Scale-aware fin profile tuning.
- Performance pass from `docs/PERFORMANCE-SPEC.md` after behavior stabilizes.
