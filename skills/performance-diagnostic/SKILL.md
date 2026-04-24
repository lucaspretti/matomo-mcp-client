---
name: performance-diagnostic
description: Diagnose page load performance issues. Use when the user asks about slow pages, load times, performance problems, or wants to understand why a site is slow.
---

# Performance Diagnostic

Analyze page load performance for a Matomo-tracked site.

## Site selection

If $ARGUMENTS contains a site ID or name, use that. If the conversation already has a site in context, use that. Otherwise, call `matomo_list_sites`, present a short numbered list (ID, name, URL), and ask which site to analyze. Do not proceed until a site is selected.

## Steps

1. **Get overall performance** using `matomo_get_page_performance` for the requested period (default: last 7 days, period: day, date: last7)

2. **Identify slow pages** using `matomo_get_top_pages` with limit 20 for the same period. Sort by `avg_page_load_time` to find the slowest pages.

3. **Check device impact** using `matomo_get_devices` to see if performance varies by device type.

4. **Check browser impact** using `matomo_get_browsers` to see if specific browsers are slower.

5. **Mobile-specific drill-down** when the user mentions "mobile", "phone", or "slow on phone": rerun steps 1 and 2 with `device: "mobile"` to get the mobile-only numbers, then compare against the all-devices baseline. Flag any page where mobile is significantly slower than desktop.

6. **Present findings** as a summary:
   - Overall avg load time and breakdown (network, server, DOM processing, DOM completion)
   - Top 5 slowest pages with their load times
   - Device/browser breakdown if significant differences exist
   - Mobile vs desktop delta if a mobile drill-down was run
   - Identify the bottleneck: is it network, server, or client-side (DOM)?

If $ARGUMENTS contains a specific URL or page path, focus the analysis on that page.

## Fallback when segments return zero

If a `device`-filtered call comes back with all-zero metrics while the same
query without `device` returns normal numbers, the Matomo server is refusing
to compute the segment for this API token (it lacks `process_new_segment` or
the segment isn't pre-archived). Do not claim "no mobile traffic" — that's
almost never the real answer.

Instead:

1. Tell the user the segment cannot be computed by the API token.
2. Build a Matomo UI URL they can open in a logged-in browser session and
   paste it:
   ```
   <matomo-host>/index.php?module=CoreHome&action=index
     &idSite=<id>&period=<period>&date=<date>
     &segment=<url-encoded segment expression>
   ```
   For mobile use `segment=deviceType%3D%3Dsmartphone%2CdeviceType%3D%3Dtablet%2CdeviceType%3D%3Dphablet`.
3. Suggest asking the Matomo admin to grant `process_new_segment` on the
   token or pre-archive device segments.
