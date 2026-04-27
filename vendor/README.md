# Vendored dependencies

## `xlsx-0.20.3.tgz`

SheetJS no longer publishes `xlsx` to the public npm registry. Instead it
distributes via `https://cdn.sheetjs.com/`, which is unreachable from
some sandboxed CI / Claude Code-on-the-web environments.

To keep `npm install` deterministic and offline-capable we vendor the
official tarball in this directory. `package.json` references it via
`"xlsx": "file:./vendor/xlsx-0.20.3.tgz"`.

### How to refresh the tarball

```bash
curl -fL -o vendor/xlsx-0.20.3.tgz https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
git add vendor/xlsx-0.20.3.tgz
git commit -m "Refresh vendored xlsx tarball"
```

After replacing the tarball, run `npm install` to pick it up locally.
