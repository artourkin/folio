# Changelog

Each PR prepares a versioned release. PR images are prereleases; merging publishes the stable version.

## 0.2.2

- Improve Apple Pencil input in iPad browsers: cancel stylus touch gestures on the PDF drawing surface and reader buttons to prevent iPadOS handwriting recognition from interrupting strokes.
- Supplement pointer input with identified stylus touch samples, recover missing pointer starts, and retain active touch strokes when the pointer stream is interrupted. Avoid duplicate strokes when both streams arrive.
- Preserve the pressure curve and existing finger navigation. Handle unavailable coalesced-pointer APIs and ignore stale samples.
- Add Chromium and WebKit regression coverage for Pencil event ordering, light pressure, cancellation, saving, and toolbar activation. Physical iPad testing remains necessary.
- No database migration or preference reset is required.

## 0.2.1

- Update clone/release links, image examples, Docker source labels, and local release defaults for the renamed `artourkin/folio` repository.
- Use the canonical Go module path `github.com/artourkin/folio` and matching Docker build metadata linker flags.
- Publish new images under `ghcr.io/artourkin/folio`. Download the new release's Compose file when upgrading; keep the existing installation directory, Compose project name, and data volume. Previously published releases keep their original image references. No database migration is needed for the rename.

## 0.2.0

- Use generic deployment examples and check source/history for private configuration before publishing releases.
- Add versioned Docker images for Linux amd64 and arm64, tested before publication.
- Publish a GitHub prerelease for each PR revision, with downloadable Docker images, checksums, image digests, and deployment instructions.
- Publish the stable version and update the `latest` image after merge.
- Report the actual build version and revision through the health endpoint and `folio -version`.
- Allow existing Compose installations to switch to a prebuilt release image without changing their data volume.

This first packaged release also includes the previously merged private user libraries, saved pen preferences, PDF handwriting, compact mobile controls, retained zoomed PDF position, and finger page swipes.
