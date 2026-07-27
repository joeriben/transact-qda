# Third-Party Notices

This project incorporates third-party software under their respective
licenses. The full license texts for each listed package are available in
the package's own source repository and inside `node_modules/<package>/` of
an installed checkout.

No dependency is under a license incompatible with AGPL-3.0-or-later. Where
packages are dual-licensed (e.g. `jszip` MIT OR GPL-3.0-or-later), this
project uses them under the MIT branch.

Generated from `npx license-checker --production` on 2026-04-14.

---

## Summary

| License                   | Count |
|---------------------------|------:|
| MIT                       |   124 |
| Apache-2.0                |    20 |
| ISC                       |    17 |
| BSD-3-Clause              |    16 |
| BlueOak-1.0.0             |     7 |
| BSD-2-Clause              |     4 |
| BSD* (= BSD-2-Clause)     |     1 |
| EPL-2.0                   |     1 |
| LGPL-3.0-or-later         |     1 |
| MIT OR GPL-3.0-or-later   |     1 |
| MIT OR CC0-1.0            |     1 |
| MIT AND Zlib              |     1 |
| **Total**                 | **194** |

## Notable components

- **@huggingface/transformers** (Apache-2.0) — runs the embedding model.
- **nomic-ai/nomic-embed-text-v1.5** (Apache-2.0) — the embedding model
  itself is *not* bundled in this repository. It is downloaded from the
  Hugging Face Hub on first use. License and model card:
  https://huggingface.co/nomic-ai/nomic-embed-text-v1.5
- **Google Material Symbols** (Apache-2.0) — icons in `static/icons/`.
  Source: https://fonts.google.com/icons
- **@img/sharp-libvips-\*** (LGPL-3.0-or-later) — used as a dynamically
  linked, independently replaceable binary. No static linkage; no changes
  to libvips. Users may substitute their own libvips build.
- **elkjs** (EPL-2.0) — used unmodified.

## Complete list (production dependencies)

### (MIT AND Zlib) (1)

- **pako** 1.0.11 — https://github.com/nodeca/pako

### (MIT OR CC0-1.0) (1)

- **type-fest** 0.13.1 — https://github.com/sindresorhus/type-fest

### (MIT OR GPL-3.0-or-later) (1)

- **jszip** 3.10.1 — https://github.com/Stuk/jszip

### Apache-2.0 (20)

- **@huggingface/transformers** 3.8.1 — https://github.com/huggingface/transformers.js
- **@img/sharp-linux-x64** 0.34.5 — https://github.com/lovell/sharp
- **b4a** 1.8.0 — https://github.com/holepunchto/b4a
- **bare-events** 2.8.2 — https://github.com/holepunchto/bare-events
- **bare-fs** 4.5.6 — https://github.com/holepunchto/bare-fs
- **bare-os** 3.8.0 — https://github.com/holepunchto/bare-os
- **bare-path** 3.0.0 — https://github.com/holepunchto/bare-path
- **bare-stream** 2.10.0 — https://github.com/holepunchto/bare-stream
- **bare-url** 2.4.0 — https://github.com/holepunchto/bare-url
- **crc-32** 1.2.2 — https://github.com/SheetJS/js-crc32
- **detect-libc** 2.1.2 — https://github.com/lovell/detect-libc
- **events-universal** 1.0.1 — https://github.com/holepunchto/events-universal
- **flatbuffers** 25.9.23 — https://github.com/google/flatbuffers
- **long** 5.3.2 — https://github.com/dcodeIO/long.js
- **openai** 6.27.0 — https://github.com/openai/openai-node
- **pdf-parse** 2.4.5 — https://github.com/mehmet-kozan/pdf-parse
- **pdfjs-dist** 5.4.296 — https://github.com/mozilla/pdf.js
- **readdir-glob** 1.1.3 — https://github.com/Yqnn/node-readdir-glob
- **sharp** 0.34.5 — https://github.com/lovell/sharp
- **text-decoder** 1.2.7 — https://github.com/holepunchto/text-decoder

### BSD* (1)

- **duck** 0.1.12 — https://github.com/mwilliamson/duck.js

### BSD-2-Clause (4)

- **dingbat-to-unicode** 1.0.1 — https://github.com/mwilliamson/dingbat-to-unicode
- **lop** 0.4.2 — https://github.com/mwilliamson/lop
- **mammoth** 1.11.0 — https://github.com/mwilliamson/mammoth.js
- **option** 0.2.4 — https://github.com/mwilliamson/node-options

### BSD-3-Clause (16)

- **@protobufjs/aspromise** 1.1.2 — https://github.com/dcodeIO/protobuf.js
- **@protobufjs/base64** 1.1.2 — https://github.com/dcodeIO/protobuf.js
- **@protobufjs/codegen** 2.0.4 — https://github.com/dcodeIO/protobuf.js
- **@protobufjs/eventemitter** 1.1.0 — https://github.com/dcodeIO/protobuf.js
- **@protobufjs/fetch** 1.1.0 — https://github.com/dcodeIO/protobuf.js
- **@protobufjs/float** 1.0.2 — https://github.com/dcodeIO/protobuf.js
- **@protobufjs/inquire** 1.1.0 — https://github.com/dcodeIO/protobuf.js
- **@protobufjs/path** 1.1.2 — https://github.com/dcodeIO/protobuf.js
- **@protobufjs/pool** 1.1.0 — https://github.com/dcodeIO/protobuf.js
- **@protobufjs/utf8** 1.1.0 — https://github.com/dcodeIO/protobuf.js
- **global-agent** 3.0.0 — https://github.com/gajus/global-agent
- **ieee754** 1.2.1 — https://github.com/feross/ieee754
- **protobufjs** 7.5.4 — https://github.com/protobufjs/protobuf.js
- **roarr** 2.15.4 — https://github.com/gajus/roarr
- **sprintf-js** 1.0.3 — https://github.com/alexei/sprintf.js
- **sprintf-js** 1.1.3 — https://github.com/alexei/sprintf.js

### BlueOak-1.0.0 (7)

- **chownr** 3.0.0 — https://github.com/isaacs/chownr
- **jackspeak** 3.4.3 — https://github.com/isaacs/jackspeak
- **minipass** 7.1.3 — https://github.com/isaacs/minipass
- **package-json-from-dist** 1.0.1 — https://github.com/isaacs/package-json-from-dist
- **path-scurry** 1.11.1 — https://github.com/isaacs/path-scurry
- **tar** 7.5.13 — https://github.com/isaacs/node-tar
- **yallist** 5.0.0 — https://github.com/isaacs/yallist

### EPL-2.0 (1)

- **elkjs** 0.11.1 — https://github.com/kieler/elkjs

### ISC (17)

- **@isaacs/cliui** 8.0.2 — https://github.com/yargs/cliui
- **@isaacs/fs-minipass** 4.0.1 — https://github.com/npm/fs-minipass
- **foreground-child** 3.3.1 — https://github.com/tapjs/foreground-child
- **glob** 10.5.0 — https://github.com/isaacs/node-glob
- **graceful-fs** 4.2.11 — https://github.com/isaacs/node-graceful-fs
- **guid-typescript** 1.0.9 — https://github.com/NicolasDeveloper/guid-typescript
- **inherits** 2.0.4 — https://github.com/isaacs/inherits
- **isexe** 2.0.0 — https://github.com/isaacs/isexe
- **json-stringify-safe** 5.0.1 — https://github.com/isaacs/json-stringify-safe
- **lru-cache** 10.4.3 — https://github.com/isaacs/node-lru-cache
- **minimatch** 5.1.9 — https://github.com/isaacs/minimatch
- **minimatch** 9.0.9 — https://github.com/isaacs/minimatch
- **pg-int8** 1.0.1 — https://github.com/charmander/pg-int8
- **semver** 7.7.4 — https://github.com/npm/node-semver
- **signal-exit** 4.1.0 — https://github.com/tapjs/signal-exit
- **split2** 4.2.0 — https://github.com/mcollina/split2
- **which** 2.0.2 — https://github.com/isaacs/node-which

### LGPL-3.0-or-later (1)

- **@img/sharp-libvips-linux-x64** 1.2.4 — https://github.com/lovell/sharp-libvips

### MIT (124)

- **@anthropic-ai/sdk** 0.78.0 — https://github.com/anthropics/anthropic-sdk-typescript
- **@babel/runtime** 7.28.6 — https://github.com/babel/babel
- **@huggingface/jinja** 0.5.6 — https://github.com/huggingface/huggingface.js
- **@img/colour** 1.1.0 — https://github.com/lovell/colour
- **@napi-rs/canvas** 0.1.80 — https://github.com/Brooooooklyn/canvas
- **@napi-rs/canvas-linux-x64-gnu** 0.1.80 — https://github.com/Brooooooklyn/canvas
- **@napi-rs/canvas-linux-x64-musl** 0.1.80 — https://github.com/Brooooooklyn/canvas
- **@phc/format** 1.0.0 — https://github.com/simonepri/phc-format
- **@pkgjs/parseargs** 0.11.0 — https://github.com/pkgjs/parseargs
- **@types/archiver** 7.0.0 — https://github.com/DefinitelyTyped/DefinitelyTyped
- **@types/node** 25.5.0 — https://github.com/DefinitelyTyped/DefinitelyTyped
- **@types/readdir-glob** 1.1.5 — https://github.com/DefinitelyTyped/DefinitelyTyped
- **@types/yauzl** 2.10.3 — https://github.com/DefinitelyTyped/DefinitelyTyped
- **@xmldom/xmldom** 0.8.11 — https://github.com/xmldom/xmldom
- **abort-controller** 3.0.0 — https://github.com/mysticatea/abort-controller
- **ansi-regex** 5.0.1 — https://github.com/chalk/ansi-regex
- **ansi-regex** 6.2.2 — https://github.com/chalk/ansi-regex
- **ansi-styles** 4.3.0 — https://github.com/chalk/ansi-styles
- **ansi-styles** 6.2.3 — https://github.com/chalk/ansi-styles
- **archiver** 7.0.1 — https://github.com/archiverjs/node-archiver
- **archiver-utils** 5.0.2 — https://github.com/archiverjs/archiver-utils
- **argon2** 0.41.1 — https://github.com/ranisalt/node-argon2
- **argparse** 1.0.10 — https://github.com/nodeca/argparse
- **async** 3.2.6 — https://github.com/caolan/async
- **balanced-match** 1.0.2 — https://github.com/juliangruber/balanced-match
- **base64-js** 1.5.1 — https://github.com/beatgammit/base64-js
- **bluebird** 3.4.7 — https://github.com/petkaantonov/bluebird
- **boolean** 3.2.0 — https://github.com/thenativeweb/boolean
- **brace-expansion** 2.0.2 — https://github.com/juliangruber/brace-expansion
- **buffer** 6.0.3 — https://github.com/feross/buffer
- **buffer-crc32** 0.2.13 — https://github.com/brianloveswords/buffer-crc32
- **buffer-crc32** 1.0.0 — https://github.com/brianloveswords/buffer-crc32
- **color-convert** 2.0.1 — https://github.com/Qix-/color-convert
- **color-name** 1.1.4 — https://github.com/colorjs/color-name
- **compress-commons** 6.0.2 — https://github.com/archiverjs/node-compress-commons
- **core-util-is** 1.0.3 — https://github.com/isaacs/core-util-is
- **crc32-stream** 6.0.0 — https://github.com/archiverjs/node-crc32-stream
- **cross-spawn** 7.0.6 — https://github.com/moxystudio/node-cross-spawn
- **define-data-property** 1.1.4 — https://github.com/ljharb/define-data-property
- **define-properties** 1.2.1 — https://github.com/ljharb/define-properties
- **detect-node** 2.1.0 — https://github.com/iliakan/detect-node
- **eastasianwidth** 0.2.0 — https://github.com/komagata/eastasianwidth
- **emoji-regex** 8.0.0 — https://github.com/mathiasbynens/emoji-regex
- **emoji-regex** 9.2.2 — https://github.com/mathiasbynens/emoji-regex
- **es-define-property** 1.0.1 — https://github.com/ljharb/es-define-property
- **es-errors** 1.3.0 — https://github.com/ljharb/es-errors
- **es6-error** 4.1.1 — https://github.com/bjyoungblood/es6-error
- **escape-string-regexp** 4.0.0 — https://github.com/sindresorhus/escape-string-regexp
- **event-target-shim** 5.0.1 — https://github.com/mysticatea/event-target-shim
- **events** 3.3.0 — https://github.com/Gozala/events
- **fast-fifo** 1.3.2 — https://github.com/mafintosh/fast-fifo
- **fast-xml-builder** 1.1.4 — https://github.com/NaturalIntelligence/fast-xml-builder
- **fast-xml-parser** 5.5.8 — https://github.com/NaturalIntelligence/fast-xml-parser
- **globalthis** 1.0.4 — https://github.com/ljharb/System.global
- **gopd** 1.2.0 — https://github.com/ljharb/gopd
- **has-property-descriptors** 1.0.2 — https://github.com/inspect-js/has-property-descriptors
- **immediate** 3.0.6 — https://github.com/calvinmetcalf/immediate
- **is-fullwidth-code-point** 3.0.0 — https://github.com/sindresorhus/is-fullwidth-code-point
- **is-stream** 2.0.1 — https://github.com/sindresorhus/is-stream
- **isarray** 1.0.0 — https://github.com/juliangruber/isarray
- **json-schema-to-ts** 3.1.1 — https://github.com/ThomasAribart/json-schema-to-ts
- **lazystream** 1.0.1 — https://github.com/jpommerening/node-lazystream
- **lie** 3.3.0 — https://github.com/calvinmetcalf/lie
- **lodash** 4.17.23 — https://github.com/lodash/lodash
- **marked** 17.0.5 — https://github.com/markedjs/marked
- **matcher** 3.0.0 — https://github.com/sindresorhus/matcher
- **minizlib** 3.1.0 — https://github.com/isaacs/minizlib
- **node-addon-api** 8.6.0 — https://github.com/nodejs/node-addon-api
- **node-gyp-build** 4.8.4 — https://github.com/prebuild/node-gyp-build
- **normalize-path** 3.0.0 — https://github.com/jonschlinkert/normalize-path
- **object-keys** 1.1.1 — https://github.com/ljharb/object-keys
- **onnxruntime-common** 1.21.0 — https://github.com/Microsoft/onnxruntime
- **onnxruntime-common** 1.22.0-dev.20250409-89f8206ba4 — https://github.com/Microsoft/onnxruntime
- **onnxruntime-node** 1.21.0 — https://github.com/Microsoft/onnxruntime
- **onnxruntime-web** 1.22.0-dev.20250409-89f8206ba4 — https://github.com/Microsoft/onnxruntime
- **path-expression-matcher** 1.2.0 — https://github.com/NaturalIntelligence/path-expression-matcher
- **path-is-absolute** 1.0.1 — https://github.com/sindresorhus/path-is-absolute
- **path-key** 3.1.1 — https://github.com/sindresorhus/path-key
- **pend** 1.2.0 — https://github.com/andrewrk/node-pend
- **pg** 8.20.0 — https://github.com/brianc/node-postgres
- **pg-cloudflare** 1.3.0 — https://github.com/brianc/node-postgres
- **pg-connection-string** 2.12.0 — https://github.com/brianc/node-postgres
- **pg-copy-streams** 7.0.0 — https://github.com/brianc/node-pg-copy-streams
- **pg-pool** 3.13.0 — https://github.com/brianc/node-postgres
- **pg-protocol** 1.13.0 — https://github.com/brianc/node-postgres
- **pg-types** 2.2.0 — https://github.com/brianc/node-pg-types
- **pgpass** 1.0.5 — https://github.com/hoegaarden/pgpass
- **platform** 1.3.6 — https://github.com/bestiejs/platform.js
- **postgres-array** 2.0.0 — https://github.com/bendrucker/postgres-array
- **postgres-bytea** 1.0.1 — https://github.com/bendrucker/postgres-bytea
- **postgres-date** 1.0.7 — https://github.com/bendrucker/postgres-date
- **postgres-interval** 1.2.0 — https://github.com/bendrucker/postgres-interval
- **process** 0.11.10 — https://github.com/shtylman/node-process
- **process-nextick-args** 2.0.1 — https://github.com/calvinmetcalf/process-nextick-args
- **readable-stream** 2.3.8 — https://github.com/nodejs/readable-stream
- **readable-stream** 4.7.0 — https://github.com/nodejs/readable-stream
- **safe-buffer** 5.1.2 — https://github.com/feross/safe-buffer
- **safe-buffer** 5.2.1 — https://github.com/feross/safe-buffer
- **semver-compare** 1.0.0 — https://github.com/substack/semver-compare
- **serialize-error** 7.0.1 — https://github.com/sindresorhus/serialize-error
- **setimmediate** 1.0.5 — https://github.com/YuzuJS/setImmediate
- **shebang-command** 2.0.0 — https://github.com/kevva/shebang-command
- **shebang-regex** 3.0.0 — https://github.com/sindresorhus/shebang-regex
- **streamx** 2.25.0 — https://github.com/mafintosh/streamx
- **string_decoder** 1.1.1 — https://github.com/nodejs/string_decoder
- **string_decoder** 1.3.0 — https://github.com/nodejs/string_decoder
- **string-width** 4.2.3 — https://github.com/sindresorhus/string-width
- **string-width** 5.1.2 — https://github.com/sindresorhus/string-width
- **strip-ansi** 6.0.1 — https://github.com/chalk/strip-ansi
- **strip-ansi** 7.2.0 — https://github.com/chalk/strip-ansi
- **strnum** 2.2.1 — https://github.com/NaturalIntelligence/strnum
- **tar-stream** 3.1.8 — https://github.com/mafintosh/tar-stream
- **teex** 1.0.1 — https://github.com/mafintosh/teex
- **ts-algebra** 2.0.0 — https://github.com/ThomasAribart/ts-algebra
- **underscore** 1.13.8 — https://github.com/jashkenas/underscore
- **undici-types** 7.18.2 — https://github.com/nodejs/undici
- **util-deprecate** 1.0.2 — https://github.com/TooTallNate/util-deprecate
- **wrap-ansi** 7.0.0 — https://github.com/chalk/wrap-ansi
- **wrap-ansi** 8.1.0 — https://github.com/chalk/wrap-ansi
- **xmlbuilder** 10.1.1 — https://github.com/oozcitak/xmlbuilder-js
- **xtend** 4.0.2 — https://github.com/Raynos/xtend
- **yauzl** 3.2.1 — https://github.com/thejoshwolfe/yauzl
- **zip-stream** 6.0.1 — https://github.com/archiverjs/node-zip-stream
- **zod** 3.25.76 — https://github.com/colinhacks/zod

---

If you believe a license or attribution is missing or incorrect, please
open an issue.
