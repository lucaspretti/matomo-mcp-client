# Roadmap

Phased plan to evolve `matomo-mcp-client` from a single-file prototype into a
well-factored, extensible MCP server.

Current baseline (v1.6.1): one ~628-line `matomo-mcp-client.js` with 16 tools,
no segment/device filtering, no tests, no types.

---

## v1.7 — Segment & device filtering (P0)

**Goal:** unblock the "fatia mobile de uma URL específica" use case. Today the
Matomo API accepts a `segment` parameter on every reporting endpoint, but the
wrapper strips it. Adding it is a ~10-line change.

- [x] Add `segment` to `commonParams` (passes through to every time-based tool)
- [x] Add `device` sugar (`mobile` | `smartphone` | `tablet` | `desktop` | `phablet`)
      that expands to the matching `deviceType==...` segment expression
- [x] Add `"range"` to the global `period` enum (today it's only in
      `matomo_search_pages`/`matomo_search_events` despite working everywhere)
- [x] Document segment syntax and device sugar in README
- [x] Add example queries exercising mobile segmentation

**Example that becomes possible:**
```
matomo_search_pages({
  siteId: 35,
  period: "range",
  date: "2025-04-24,2026-04-24",
  urlPattern: "bulletin/download",
  device: "mobile"
})
```

---

## v1.7.5 — Live-API segment workaround

**Goal:** bypass the "segment silently returns zero" trap. Matomo only serves
aggregated metrics for pre-archived segments, but `Live.getLastVisitsDetails`
returns raw per-visit data regardless of archive state, and accepts arbitrary
segments. Today our wrapper exposes `matomo_get_last_visits` with no
period/date/segment controls, so callers can't use this escape hatch.

- [ ] Expand `matomo_get_last_visits` with `period`, `date`, `segment`, and
      `device` (same params as the other time-based tools)
- [ ] Add a new `matomo_count_visits_by_segment` tool that:
      - calls `Live.getLastVisitsDetails` with `filter_limit=-1`,
        `doNotFetchActions=1`
      - returns the visit count + per-device sub-split
      - optionally accepts a `urlPattern` to post-filter `actionDetails`
      - warns when the result set would be very large (> 10k visits)
- [ ] Document in the README and all skills that this is the right tool when
      the user asks for mobile/desktop breakdowns on a specific URL and the
      standard segment route returns zero
- [ ] Update the "Fallback when segments return zero" section in the skills to
      try this tool BEFORE suggesting the browser URL

**Motivating example:** "how many mobile visits did `/bulletin/download` get
in the last 12 months" — solvable without admin intervention.

---

## v1.7.6 — Bulk request batching

**Goal:** today every "report" skill (traffic-report makes 6+ sequential calls,
performance-diagnostic makes 4+) pays N round-trips to Matomo. The API has a
first-class batching endpoint we're not using.

`API.getBulkRequest` accepts an array of URL-encoded method calls via the
`urls[0]`, `urls[1]`, ... parameters and returns an array of results in the
same order. Single HTTP request, same token, same segment — works with POST
to avoid URI length limits.

- [ ] Add a thin `matomo_batch` tool that accepts an array of
      `{method, args}` and wraps `API.getBulkRequest`
- [ ] Internally rewrite hot-path tools to call `callMatomoAPI` via the
      batch path when the skill pre-declares its calls (optional; explicit
      opt-in keeps per-tool semantics simple)
- [ ] Skills: rewrite `traffic-report` to issue one batch for steps 1–6,
      instead of one call per step. Document latency improvement (should be
      ~5-10x faster for reports on slow Matomo instances)

Docs: https://developer.matomo.org/api-reference/reporting-api (Bulk Requests)

---

## v1.7.7 — Response shaping & row evolution

**Goal:** close gaps found while reviewing the Matomo Reporting API docs.

Matomo has several built-in response-shaping params we ignore today, plus a
whole API method for time-series that we don't expose:

- [ ] Pass `hideColumns` / `showColumns` through on every tool (CSV of column
      names). Today `filterResponseFields` does this client-side AFTER the
      full payload has been transferred — server-side would cut bandwidth.
- [ ] Expose `filter_truncate` (merges tail rows into an "Others" summary row)
      — useful for long-tail reports like referrers or pages
- [ ] Expose `filter_offset` for paginating past `filter_limit`
- [ ] Add `format_metrics=0` opt-in for callers who want raw numbers
      (e.g. `0.56` instead of `"56%"`) — easier to crunch in Python/JS
- [ ] New tool `matomo_get_row_evolution` wrapping `API.getRowEvolution`
      for time-series of a specific row label (e.g. daily visits for one
      specific URL over N days). Signature:
      `{siteId, apiModule, apiAction, label, period, date, ...segment}`

Docs:
- https://developer.matomo.org/api-reference/reporting-api (Optional params)
- https://developer.matomo.org/api-reference/reporting-api-apiModule_apiAction-combinations (getRowEvolution)

---

## v1.7.8 — Segment discovery

**Goal:** when segment-based calls return zero, the user has no way to tell
which segments ARE pre-archived on the server (and therefore work) vs which
are ad-hoc (and silently return empty).

- [ ] New tool `matomo_list_segments` wrapping `SegmentEditor.getAll`, with
      optional `idSite` filter. Returns `{idsegment, name, definition, hash,
      auto_archive, enable_all_users}`.
- [ ] Document in the README that users can hit pre-archived segments by
      referencing their `definition` string directly — those always work
      regardless of `process_new_segment` permission.
- [ ] Wire into the "Fallback when segments return zero" section in the
      skills: add "call matomo_list_segments first to find pre-archived
      segments near your query" as option zero.

Docs: https://developer.matomo.org/api-reference/reporting-api-metadata

---

## v1.8 — File split & module boundaries

**Goal:** the 628-line monolith is readable today but every new tool or
transport adds friction. Split into a small `src/` tree with clear seams.

Proposed layout:
```
matomo-mcp-client.js      # thin entrypoint (~20 lines)
src/
  config.js               # argv + env parsing, validateConfig
  api-client.js           # callMatomoAPI, httpsAgent, retry logic
  helpers.js              # jsonResponse, filterResponseFields, commonParams, DEVICE_SEGMENTS
  schemas.js              # shared inputSchema fragments (siteIdProp, periodDateProps, segmentProp, ...)
  tools/
    index.js              # aggregates TOOLS + toolHandlers
    discovery.js          # list_sites
    traffic.js            # get_visits, get_live_counters, get_last_visits
    pages.js              # top_pages, page_titles, entry_pages, exit_pages, search_pages
    search.js             # search_keywords, search_no_results
    performance.js        # page_performance, devices, browsers
    referrers.js          # referrers, search_engines, ai_assistants, campaigns
    events.js             # search_events
  server.js               # MCP wiring (setRequestHandler, startup)
```

- [ ] Extract config and API client
- [ ] Extract helpers and schemas
- [ ] One module per tool category (each < 80 lines)
- [ ] Keep the stdio entrypoint as a thin shim so the `.mcp.json` path stays
      backwards compatible

---

## v1.9 — Tests

**Goal:** zero coverage today. Add a minimal test harness so refactors are
safe.

- [ ] Choose runner (`node --test` keeps deps at zero; vitest is nicer DX)
- [ ] Unit tests for `commonParams`, `filterResponseFields`, device sugar
      expansion
- [ ] Contract tests for `callMatomoAPI` using `nock` or a fake fetch
- [ ] One end-to-end test per tool category that mocks Matomo responses
- [ ] GitHub Actions matrix (Node 20/22/24) already exists — wire tests into it

---

## v2.0 — TypeScript / JSDoc types

**Goal:** today the tool input shapes live only in JSON Schema. Adding types
catches schema/handler drift at dev time and improves tool discovery for LLMs.

Two options, pick one:
- [ ] **JSDoc + `checkJs`**: zero build step, keeps `.js` extension. Good
      enough for this size.
- [ ] **Full TypeScript**: stricter, but adds `tsc` + `dist/`. Justifiable
      if the codebase keeps growing past 1.5k LOC.

---

## v2.1 — Response shaping & caching

**Goal:** some Matomo endpoints are slow (several seconds on large
date ranges) and response payloads can be huge. Today
`filterResponseFields` is the only shaping tool and it's only used in two
places.

- [ ] Declarative per-tool field lists (replace ad-hoc filters in
      `search_pages`/`search_events`)
- [ ] Optional in-memory TTL cache keyed by `(method, sorted params)`
- [ ] Expose cache TTL via env var, default 60s
- [ ] Respect Matomo's `Last-Modified` header where present

---

## v2.2 — Convenience wrappers

**Goal:** common queries shouldn't require users to craft `period=range`
plus ISO dates by hand.

- [ ] `lastDays: N` / `lastMonths: N` / `lastYears: N` shortcuts that resolve
      to `period=range` + computed `date`
- [ ] Shortcut segments beyond device: `visitorType==new|returning`,
      `country==...`, `referrerType==...`
- [ ] Named presets (`preset: "last_12_months"`, `preset: "ytd"`)

---

## v2.3 — Observability & DX

- [ ] Structured JSON logs (stderr) with a `--log-level` flag
- [ ] `--dry-run` mode that prints the Matomo URL without calling
- [ ] `--list-segments` helper that calls `API.getSegmentsMetadata` so users
      can discover what segments the server supports
- [ ] README cookbook: top 10 real queries with full MCP call payloads

---

## v3.0 — Transport & distribution

**Goal:** today the only transport is stdio via Node/Docker. MCP now has a
remote HTTP transport and several clients favour it for easier deployment.

- [ ] HTTP (Streamable) transport option, guarded by a flag
- [ ] Publish to npm as `matomo-mcp-client` (so `npx matomo-mcp-client` works)
- [ ] Optional hosted Docker image on GHCR
- [ ] Split the Claude Desktop / Claude Code / VS Code config examples into
      their own docs page

---

## Non-goals (for now)

- **Write operations.** Matomo's reporting API is read-only by design; sites
  and users management is out of scope for this client.
- **Multi-instance Matomo.** One server = one Matomo host. If you need
  multiple, run multiple instances.
- **BI-style joins across tools.** LLM does that; the server stays thin.
