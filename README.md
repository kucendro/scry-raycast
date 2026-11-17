# scry-raycast

A Raycast extension for [scry](https://github.com/JirkaKlimes/scry). The extension is in [`extension/`](extension), and its README is the Store page.

## Development

`nix develop` gives node, just, lefthook and nixfmt.

```sh
just install   # npm ci in extension/, git hooks
just dev       # run the extension in Raycast
just check     # tests, build, lint
just fmt       # prettier, nixfmt
```

The tests in `test/` stay out of the extension, as the Store takes only what users run.

## Publish

```sh
cd extension
npm run publish
```
