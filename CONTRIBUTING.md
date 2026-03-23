# Contributing

## Project Shape

- `ui/` is the active desktop frontend shipped by the default Tauri build.
- `src-tauri/` contains the native desktop backend.
- `components/` contains shared UI primitives and editor components used by the desktop app.
- `utils/` contains the shared rendering, export, and editor logic used by the desktop frontend.

## Local Development

1. Install dependencies with `npm install`.
2. Run the desktop app with `npm run tauri:dev`.
3. Run the production build with `npm run build`.
4. Run tests with `npm test -- --run`.

## Contribution Guidelines

- Prefer small, focused changes.
- Keep logic out of large UI components when it can live in `utils/` or a dedicated hook/module.
- Preserve the active `ui/` path as the primary product surface.
- Add or update tests for export, rendering, or Tauri bridge behavior when you touch those paths.
- Avoid committing generated output, build artifacts, or local installer binaries.

## Notes For Maintainers

- Export behavior depends on DOM presentation settling before capture. If you change export visuals, verify both preview and exported output.
- The repository now uses a single supported frontend path through `ui/`.