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
