default:
    @just --list --unsorted

install:
    cd extension && npm ci
    lefthook install

dev:
    cd extension && npm run dev

test:
    node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test 'test/*.test.ts'

check: test
    #!/usr/bin/env bash
    set -euo pipefail
    extension/node_modules/.bin/tsc -p test
    out=$(mktemp -d)
    trap 'rm -rf "$out"' EXIT
    cd extension
    npx ray build --non-interactive --exit-on-error -e dist -o "$out"
    npx ray lint --non-interactive

fmt:
    extension/node_modules/.bin/prettier --config extension/.prettierrc --write .
    nixfmt flake.nix
