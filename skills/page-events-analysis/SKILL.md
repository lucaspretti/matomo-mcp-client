---
name: page-events-analysis
description: Cross-reference page views with event usage to calculate feature adoption rates. Use this when the user wants to know how many visitors used a specific feature (event) on a set of pages matching a URL pattern.
---

# Page Events Analysis

Analyze page views and events for specific URL patterns, then cross-reference them to calculate usage rates. This answers questions like "how many people used feature X on pages Y".

## Gather Parameters

Ask the user for (or infer from context):

1. **Site ID** - the Matomo site to query
2. **URL pattern** - regex to filter pages (e.g. `guidelines-epc|guidelines-pct`)
3. **Event filter** - the event name or action to cross-reference (e.g. `Toggle Show Modifications`)
4. **Date range** - start and end dates (default: last 30 days from today)
5. **Device filter** (optional) - `desktop`, `mobile`, `smartphone`, `tablet`, or `phablet` if the user asks about a specific device slice (e.g. "how many mobile users toggled X")

## Execution Steps

### 1. Fetch page views

Call `matomo_search_pages` with:
- `siteId`: the site ID
- `urlPattern`: the URL pattern
- `period`: `range` when the user gave start/end dates, otherwise `month` for long windows and `day` for short ones
- `date`: comma-separated start,end range when `period=range` (e.g. `2026-02-01,2026-02-28`)
- `device`: pass through if the user asked for a device slice

Sum up `nb_visits` (unique visitors) and `nb_hits` (page views) across all matching pages. Keep monthly totals if the range spans multiple months.

### 2. Fetch event counts

Call `matomo_search_events` with:
- `siteId`: the site ID
- `filterPattern`: the event filter
- `dimension`: `name` (to see specific event values like on/off toggles)
- `period`, `date`, `device`: same as above

Sum up `nb_events` across all matching events. Keep monthly totals.

### 3. Calculate usage rate

```
usage_rate = (total_events / total_page_views) * 100
```

If both on/off event variants exist (e.g. "Toggle Show Modifications On" and "Toggle Show Modifications Off"), report them separately and combined.

### 4. Present findings

Provide a summary with:

**Key figures:**
- Total page views (hits) and unique visitors
- Total events (broken down by variant if applicable)
- Overall usage rate %

**Monthly breakdown table:**

| Month | Page Views | Unique Visitors | Events | Usage Rate |
|-------|-----------|-----------------|--------|------------|
| ...   | ...       | ...             | ...    | ...        |
| **Total** | **...** | **...** | **...** | **...%** |

**Observations:**
- Note any trends (increasing/decreasing adoption)
- Flag months with unusual spikes or drops
- If usage rate is very low or very high, call it out
