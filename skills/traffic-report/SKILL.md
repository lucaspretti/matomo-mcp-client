---
name: traffic-report
description: Generate a traffic overview report. Use when the user asks for a traffic summary, weekly/monthly report, site overview, or wants to understand visitor trends.
---

# Traffic Report

Generate a comprehensive traffic report for the Matomo-tracked site. Default period is last 7 days unless specified in $ARGUMENTS.

1. **Visits summary** using `matomo_get_visits` for the requested period

2. **Real-time snapshot** using `matomo_get_live_counters` (last 30 minutes)

3. **Top pages** using `matomo_get_top_pages` with limit 10

4. **Entry pages** using `matomo_get_entry_pages` with limit 5 to show where visitors land

5. **Traffic sources** using `matomo_get_search_engines` and `matomo_get_ai_assistants` with limit 5 each

6. **Present as a report** with sections:
   - Key metrics: visits, unique visitors, actions, bounce rate, avg time on site
   - Currently online (live counters)
   - Top pages (table: page, visits, avg time, bounce rate)
   - Where visitors come from (search engines, AI assistants)
   - Top landing pages

Keep the report concise and highlight anything unusual (high bounce rates, traffic spikes, etc.).
