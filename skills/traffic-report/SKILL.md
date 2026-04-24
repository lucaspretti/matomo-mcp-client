---
name: traffic-report
description: Generate a traffic overview report. Use when the user asks for a traffic summary, weekly/monthly report, site overview, or wants to understand visitor trends.
---

# Traffic Report

Generate a comprehensive traffic report for a Matomo-tracked site. Default period is last 7 days unless specified in $ARGUMENTS.

## Site selection

If $ARGUMENTS contains a site ID or name, use that. If the conversation already has a site in context, use that. Otherwise, call `matomo_list_sites`, present a short numbered list (ID, name, URL), and ask which site to analyze. Do not proceed until a site is selected.

## Steps

1. **Visits summary** using `matomo_get_visits` for the requested period

2. **Real-time snapshot** using `matomo_get_live_counters` (last 30 minutes)

3. **Top pages** using `matomo_get_top_pages` with limit 10

4. **Entry pages** using `matomo_get_entry_pages` with limit 5 to show where visitors land

5. **Traffic sources** using `matomo_get_search_engines` and `matomo_get_ai_assistants` with limit 5 each

6. **Device segment** using `matomo_get_devices` for the same period to show the desktop vs mobile split. If the user asked for a mobile-only report, pass `device: "mobile"` to steps 1, 3, 4 instead and note that the whole report is scoped to smartphone+tablet+phablet.

7. **Present as a report** with sections:
   - Key metrics: visits, unique visitors, actions, bounce rate, avg time on site
   - Currently online (live counters)
   - Top pages (table: page, visits, avg time, bounce rate)
   - Where visitors come from (search engines, AI assistants)
   - Top landing pages
   - Device split (desktop vs mobile share)

Keep the report concise and highlight anything unusual (high bounce rates, traffic spikes, etc.).

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
