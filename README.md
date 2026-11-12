# dsh-auto-review-router

Route [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) auto-review calls to a **fixed model**, independent of the working model. Chat and development can keep using any model you like.

## Why

Harness's auto authorization review sends its own request with `temperature: 0`, and it uses whatever provider/model the current session selected. Some OpenAI-compatible gateways only accept `temperature: 1`, so the review request fails with:

```text
`temperature` only 1 is allowed for this model
```

Because the review runs before every tool call, that failure blocks all tools. Pointing the review at a model that accepts the parameter fixes this without changing your working model or disabling review.

Separately, the review request can fail transiently at the transport layer — an occasional dropped connection or empty reply. The official plugin fails closed on the first failure, so a hiccup looks like a broken reviewer. This plugin retries once **before** any chunk is produced.

## How it works

It listens to the official `llm/stream` waterfall and rewrites only requests whose `purpose` is `auto-review`:

```js
ctx.on('llm/stream', (options, next) => {
  if (options.purpose !== 'auto-review') return next();
  // re-dispatch with the configured reviewer, guarded against recursion
});
```

It does not copy the review plugin, alter approval rules, or modify `app.asar`. Approval decisions, denials, and fail-closed behaviour stay with the official plugin.

> **Note:** Cordis's waterfall `next()` takes no arguments, so a rewritten request cannot be passed through `next(request)`. This plugin marks the rewritten request in a `WeakSet` and re-enters the public `ctx.llm.stream()`, which makes routing effective without recursing.

## Install

Requires Harness `0.2.2-rc.1` (or a version with the same `llm/stream` contract), Node.js `>=22.19.0`, and the official **Auto review** plugin enabled.

```sh
dsh plugin --profile desktop add <path-to-this-repo>
```

`pnpm add` only installs the dependency. If the package is missing from `dsh.profile.bundles` in the profile's `package.json`, add it manually. The package's `cordis.patch.yml` registers the `auto-review-router` row.

Then set your reviewer in the profile's `cordis.patch.yml`:

```yaml
- id: auto-review-router
  name: 'dsh-auto-review-router'
  config:
    provider: your-review-provider
    model: your-reviewer-model
    attempts: 2   # optional, defaults to 2
```

Restart Harness and select **Auto review** in the session permission menu. While a session stays on full access, the reviewer is not involved.

## A note on retries

A retry only happens while the review has produced no chunk yet. Once the reviewer has started streaming, a failure is surfaced as-is rather than resending the request, so one pending tool call is never reviewed twice. Two consecutive failures still fail the call, exactly as the official plugin would.

## Test

```sh
node --test
```

Covers: any working model routes to the configured reviewer; non-review requests keep their object identity; frozen requests are not mutated; reviews are redispatched exactly once; a pre-first-chunk failure is retried once; a mid-stream failure is not retried; repeated failures still surface; an unconfigured reviewer leaves everything untouched.

## Scope

- The reviewer still sends `temperature: 0`. Pick a route that accepts it.
- This route has no review UI of its own; the official plugin still denies and fails closed.
- Re-check the `llm/stream` contract after upgrading Harness.

## License

MIT
