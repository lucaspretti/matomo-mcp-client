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

## v1.7.5 — Live-API segment workaround ✅

- [x] Expand `matomo_get_last_visits` with `period`, `date`, `segment`,
      `device`, `filter_offset` and `doNotFetchActions`
- [x] Add `matomo_count_visits_by_segment` (Live API with `filter_limit=-1`,
      `doNotFetchActions=1` when no `urlPattern`, per-device + top-10 country
      breakdown, optional URL pattern post-filter)
- [x] Document in README + all four device-aware skills

Validated: `{device:"mobile", period:"day", date:"yesterday"}` on EPO site 35
returned 2 039 visits with 87% Smartphone / 8% Tablet / 4% Phablet split.

---

## v1.7.6 — Bulk request batching ✅

- [x] `matomo_batch` tool wrapping `API.getBulkRequest`. Takes
      `calls: [{method, params}, ...]`, returns an array of results in order.
- [ ] Rewrite `traffic-report` skill to issue one batch instead of 6 calls
      (follow-up — kept out of this phase to keep the diff focused on tool
      surface)

---

## v1.7.7 — Response shaping & row evolution ✅

- [x] `hideColumns` / `showColumns` (CSV) passthrough on every tool
- [x] `filter_offset` / `filter_truncate` passthrough on every tool
- [x] `format_metrics` passthrough (default true/Matomo; set false for raw
      numbers)
- [x] `matomo_get_row_evolution` tool wrapping `API.getRowEvolution`
      (signature: `{siteId, apiModule, apiAction, label, idSubtable?, column?,
      period, date, segment, device}`)

---

## v1.7.8 — Segment discovery ✅

- [x] `matomo_list_segments` tool wrapping `SegmentEditor.getAll`. Returns
      `{idsegment, name, definition, hash, auto_archive, enable_all_users}`.
      Validated on EPO: exposes "EPO Internal", "New visitors", "Returning
      visitors", etc.
- [x] Skill fallback sections updated to call this tool first when segments
      return zero.

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
