---
name: performance-diagnostic
description: Diagnose page load performance issues. Use when the user asks about slow pages, load times, performance problems, or wants to understand why a site is slow.
---

# Performance Diagnostic

Analyze page load performance for the Matomo-tracked site. Follow these steps:

1. **Get overall performance** using `matomo_get_page_performance` for the requested period (default: last 7 days, period: day, date: last7)

2. **Identify slow pages** using `matomo_get_top_pages` with limit 20 for the same period. Sort by `avg_page_load_time` to find the slowest pages.

3. **Check device impact** using `matomo_get_devices` to see if performance varies by device type.

4. **Check browser impact** using `matomo_get_browsers` to see if specific browsers are slower.

5. **Present findings** as a summary:
   - Overall avg load time and breakdown (network, server, DOM processing, DOM completion)
   - Top 5 slowest pages with their load times
   - Device/browser breakdown if significant differences exist
   - Identify the bottleneck: is it network, server, or client-side (DOM)?

If $ARGUMENTS contains a specific URL or page path, focus the analysis on that page.
