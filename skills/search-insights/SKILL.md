---
name: search-insights
description: Analyze site search behavior and content gaps. Use when the user asks about what visitors are searching for, search terms, no-result searches, or content gaps.
---

# Search Insights

Analyze internal site search to understand what visitors are looking for and identify content gaps.

## Site selection

If $ARGUMENTS contains a site ID or name, use that. If the conversation already has a site in context, use that. Otherwise, call `matomo_list_sites`, present a short numbered list (ID, name, URL), and ask which site to analyze. Do not proceed until a site is selected.

## Steps

1. **Top search keywords** using `matomo_get_search_keywords` with limit 20 for the requested period (default: last 30 days, period: day, date: last30)

2. **Failed searches** using `matomo_get_search_no_results` with limit 20 for the same period

3. **Present findings**:
   - Most searched terms (table: keyword, searches, results found)
   - Top failed searches (terms with no results) as content gap opportunities
   - Patterns: are visitors searching for things that should be easy to find?
   - Recommendations: which content should be created or made more discoverable

If $ARGUMENTS contains a specific keyword, focus analysis around that topic.

If the user asks about mobile-only search behavior, pass `device: "mobile"` to both calls above to scope the analysis to smartphone+tablet+phablet traffic.

## Fallback when segments return zero

If a `device`-filtered call comes back with all-zero metrics while the same
query without `device` returns normal numbers, the Matomo server is refusing
to aggregate the segment for this API token (it lacks `process_new_segment`
or the segment isn't pre-archived). Do not claim "no mobile traffic" — that's
almost never the real answer.

Try these in order:

1. **Fall back to the Live API.** `Live.getLastVisitsDetails` serves raw
   per-visit data and does NOT need segment archiving. Call it directly if
   you can reach a shell:
   ```bash
   curl -s -X POST "$MATOMO_HOST/index.php" \
     --data-urlencode "module=API" \
     --data-urlencode "method=Live.getLastVisitsDetails" \
     --data-urlencode "idSite=<id>" \
     --data-urlencode "period=<period>" --data-urlencode "date=<date>" \
     --data-urlencode "segment=deviceType==smartphone,deviceType==tablet,deviceType==phablet" \
     --data-urlencode "filter_limit=-1" \
     --data-urlencode "doNotFetchActions=1" \
     --data-urlencode "format=JSON" \
     --data-urlencode "token_auth=$MATOMO_TOKEN_AUTH" | jq 'length'
   ```
   The length of the returned array equals the visit count. For URL filters,
   drop `doNotFetchActions=1` and grep `actionDetails[].url` client-side.
   A dedicated MCP tool for this is planned (v1.7.5, see ROADMAP.md).
2. **Build a Matomo UI URL** the user can open in a logged-in browser
   session (the UI uses the user's permissions, not the token):
   ```
   <matomo-host>/index.php?module=CoreHome&action=index
     &idSite=<id>&period=<period>&date=<date>
     &segment=deviceType%3D%3Dsmartphone%2CdeviceType%3D%3Dtablet%2CdeviceType%3D%3Dphablet
   ```
3. **Longer-term fix:** ask the Matomo admin to grant `process_new_segment`
   on the token or pre-archive the common segments.
