# TreeTalk package provenance and correction record

## Verified migration input

The current migration input is the user-provided Windows distribution:

- Uploaded file: `TreeTalk-win-x64(4).zip`
- SHA-256: `48c5e4716656c9f221b8fca99c3a9d435996884b211bfd05b1a66b142cc6fea5`
- Product name inside the package: `TreeTalk`
- Product version inside the package: `0.1.0`
- Electron runtime inside the package: `42.5.0`
- Electron entry point: `dist-electron/electron/main.js`

The newly uploaded `(4)` archive was compared byte-for-byte with the previously supplied `TreeTalk-win-x64(2).zip`. Their SHA-256 values are identical, so they are the same input package.

## Incorrect release withdrawal

The previously published GitHub Release `v0.2.3` was produced before the legacy repository source was removed. It was built from the old repository project rather than from the verified package listed above.

Therefore:

- `v0.2.3` must not be treated as a build of the user-provided TreeTalk package;
- its Windows and macOS assets are being withdrawn;
- the version number `0.2.3` does not match the verified input package version `0.1.0`;
- the previous release must not be used as evidence of successful macOS migration.

## Correct release requirements

A corrected release may only be published after all of the following checks pass:

1. The build input is tied to SHA-256 `48c5e4716656c9f221b8fca99c3a9d435996884b211bfd05b1a66b142cc6fea5`.
2. The packaged application reports TreeTalk version `0.1.0`.
3. Windows x64 is rebuilt and passes an actual startup check.
4. macOS Intel x64 and Apple Silicon arm64 are built on a real macOS runner.
5. Each macOS application is signed before distribution.
6. `codesign --verify --deep --strict` succeeds for each `.app` bundle.
7. The main executable architecture matches the asset name.
8. DMG and ZIP archives preserve bundle permissions and metadata.
9. SHA-256 checksums are generated from the final uploaded assets.

## macOS signing limitation

An ad-hoc signature can make the application bundle structurally valid and verifiable, but it is not the same as Apple Developer ID signing and notarization.

Without an Apple Developer ID certificate and Apple notarization credentials, macOS may still show an “unidentified developer” warning. A corrected package must not claim to be notarized unless the notarization process actually completed successfully.

## Removed legacy content

The previous `backend/`, `frontend/`, `build/`, `scripts/`, `tests/`, `docs/`, old packaging configuration and obsolete workflows belonged to the earlier repository project and were intentionally removed. They are not valid sources for the corrected TreeTalk release.
