# Browser Graphics Assets

The browser client loads the current PNG sprite archives from `res/gx*.zip`. The dev
server exposes those read-only repository assets under `/assets/<archive-name>` so
browser code can request `/assets/gx1.zip`, `/assets/gx1_patch.zip`, and related
overlay archives without serving arbitrary repository paths.

`browser/src/assets/sprite-assets.js` is the public browser entry point:

- `loadSpriteAssets(options)` opens required base archives and optional overlay archives.
- `listEntries(archiveName)` returns zip entries discovered from the real central directory.
- `hasSprite(spriteId)` checks for an eight-digit PNG sprite name such as `00000800.png`.
- `readSprite(spriteId)` returns the selected PNG bytes from the highest-priority loaded archive.
- `decodeSprite(spriteId)` returns `{ width, height, pixels }` where `pixels` is RGBA canvas data ready for texture upload.

Required base archives are fatal if missing. Optional patch or mod archives are skipped when
the dev server returns `404`, and skipped names are reported through
`missingOptionalArchives`.

The Playwright sprite tests use the real Git LFS assets under `res/`. They do not mock zip
lookup or PNG decoding. Before running `npm test` from `browser/`, make sure the working
tree has real archive contents rather than Git LFS pointer files:

```sh
git lfs pull
file ../res/gx1.zip
```

`file ../res/gx1.zip` should report a Zip archive. If it reports text, the sprite tests
cannot validate the browser asset path.
