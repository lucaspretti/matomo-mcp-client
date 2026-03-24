---
name: search-insights
description: Analyze site search behavior and content gaps. Use when the user asks about what visitors are searching for, search terms, no-result searches, or content gaps.
---

# Search Insights

Analyze internal site search to understand what visitors are looking for and identify content gaps.

1. **Top search keywords** using `matomo_get_search_keywords` with limit 20 for the requested period (default: last 30 days, period: day, date: last30)

2. **Failed searches** using `matomo_get_search_no_results` with limit 20 for the same period

3. **Present findings**:
   - Most searched terms (table: keyword, searches, results found)
   - Top failed searches (terms with no results) as content gap opportunities
   - Patterns: are visitors searching for things that should be easy to find?
   - Recommendations: which content should be created or made more discoverable

If $ARGUMENTS contains a specific keyword, focus analysis around that topic.
