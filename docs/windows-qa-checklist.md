# Windows QA Checklist (StepFlow)

Use this checklist before sharing a Windows build.

## Build and Install

- Run `npm run dist:win`.
- Confirm installer exists at `release/StepFlow Setup 1.0.0.exe`.
- Install with default options.
- Launch app from Start Menu and Desktop shortcut.
- Verify app appears in Task Manager and window is visible.

## Capture Flows

- Studio mode: Capture full screen.
- Studio mode: Capture selection area and confirm output is cropped.
- Retake mode from Step Inspector: full-screen retake.
- Retake mode from Step Inspector: selection retake.
- Overlay pill mode: full-screen capture.
- Overlay pill mode: selection capture and confirm crop accuracy.

## Multi-Monitor and DPI

- Single monitor at 100% scale.
- Single monitor at 125% or 150% scale.
- Dual monitor mixed scale (for example 100% + 150%).
- Cursor on monitor 1, then monitor 2, run selection capture from both.
- Test with monitor arranged left/top so coordinates can be negative.

## Window Behavior

- Minimize to overlay pill and restore to studio.
- Verify pill does not flash rapidly.
- Verify no off-screen or hidden-window launch.
- Verify second launch focuses existing instance.

## Export and File I/O

- Export PDF, PPTX, HTML, Markdown, and StepFlow bundle.
- Save/open projects in paths with spaces.
- Save/open projects in paths with non-ASCII characters.

## Diagnostics

- If launch or capture fails, inspect log:
  - `%APPDATA%/StepFlow/logs/runtime.log`
- Confirm capture telemetry lines exist:
  - `[Capture] start`
  - `[Capture] selection rect`
  - `[Capture] crop applied`

## Release Readiness

- Verify app icon in taskbar/start menu/installer.
- Verify uninstall works.
- Confirm SmartScreen behavior (expected for unsigned builds).
- Record exact version and commit hash used for the release.
