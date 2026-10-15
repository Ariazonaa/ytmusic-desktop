# Contributing

Thanks for wanting to help. The easiest way in is often a plugin: it needs no
build, no Rust and no change to the app.

## Plugins

- Write one with [docs/plugins.md](docs/plugins.md), starting from
  [`examples/plugins/template`](examples/plugins/template).
- Share it in the
  [Plugins category of the Discussions](https://github.com/Ariazonaa/ytmusic-desktop/discussions/categories/plugins).
- Missing something in the API? Open a
  [Plugin API issue](https://github.com/Ariazonaa/ytmusic-desktop/issues/new?template=plugin-api.yml).

## Bugs and ideas

Use the [issue forms](https://github.com/Ariazonaa/ytmusic-desktop/issues/new/choose).
For a bug, the version, the plugins that are on and a few lines from the log
help most.

## Changes to the app

1. For anything larger than a fix, open an issue first, so we can agree on the
   approach before you spend time on it.
2. Set up the project as [docs/development.md](docs/development.md) describes.
3. Before you open the pull request, run:

   ```sh
   npm test
   npm run typecheck
   cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
   ```

4. Say in the pull request what you checked in the running app, not only in
   the tests. YouTube Music changes often, and much of the app only shows its
   faults there.

Texts the app shows exist in English and German; a test fails when a German
one is missing. If you don't speak German, leave the English text in the
German table and say so in the pull request.

By contributing you agree that your work is published under the
[MIT license](LICENSE).
