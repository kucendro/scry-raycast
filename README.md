# scry

grep for images: search by metadata, OCR text, and meaning

The search runs on [scry](https://github.com/JirkaKlimes/scry), a command-line tool by [JirkaKlimes](https://github.com/JirkaKlimes).

## Setup

1. [Install scry](https://github.com/JirkaKlimes/scry#install)
2. Run Search, and choose the folder to search.

The extension looks for scry in your PATH, `~/.local/bin`, `~/.cargo/bin` and the Nix profiles. If scry is somewhere else, set its path in the extension preferences.

The first search downloads the SigLIP 2 model (about 500 MB).
