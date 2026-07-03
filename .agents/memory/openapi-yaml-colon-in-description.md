---
name: OpenAPI YAML unquoted colon in description
description: orval codegen fails with "Failed to resolve input" when openapi.yaml has unquoted ": " inside a plain-scalar description
---

`description: Some text (alias: foo)` is invalid YAML — a bare colon-space inside
an unquoted plain scalar is ambiguous with a mapping key. Strict parsers (Python
`pyyaml`, JS `js-yaml`) reject it; the file can sit broken for a long time because
nothing re-validates `openapi.yaml` until codegen actually runs.

**Why:** orval's underlying parser surfaces this as a generic, misleading
`Failed to resolve input: Please provide a valid string value or pass a loader
to process the input` — it does not point at the offending line, making it look
like a config/tooling problem (e.g. jiti/bundler issues) rather than a YAML
syntax error.

**How to apply:** if orval codegen fails with that exact message, first
validate the YAML directly with `js-yaml` (or `pyyaml`) to get the real line
number, rather than assuming it's an orval/config regression:
```js
const yaml = require(".../js-yaml/...");
yaml.load(fs.readFileSync("lib/api-spec/openapi.yaml", "utf8"));
```
Fix by quoting any `description:` (or other plain scalar) value that contains
`": "` mid-string, e.g. `description: "Payout mode (alias: mode)"`.
