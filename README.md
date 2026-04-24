
# Matomo MCP Server

An MCP (Model Context Protocol) server that acts as a client to the Matomo Analytics API. It exposes Matomo analytics data as MCP tools, allowing any MCP-compatible LLM client (Claude Desktop, Claude Code, etc.) to query your Matomo instance using natural language.

In other words: it's an **MCP server** (tools over stdio) and a **Matomo API client** (HTTP requests) in one.

- Direct connection to your Matomo instance, no remote proxy
- 16 analytics tools: traffic, pages, search, performance, and traffic sources
- Segment filtering on every time-based tool, including a `device` shortcut for mobile/desktop slicing
- Custom date ranges via `period=range` + `date=YYYY-MM-DD,YYYY-MM-DD`
- Docker ready or run with Node.js
- Credentials stay local, never sent to third parties
- Retry logic with exponential backoff and timeout handling
- Supports self-signed certificates (common for internal servers)

## Installation

### Option 1: Docker

```bash
git clone https://github.com/lucaspretti/matomo-mcp-client
cd matomo-mcp-client
docker build -t matomo-mcp-server .
cp .env.example .env
# Edit .env with your Matomo URL and API token
```

### Option 2: Node.js

```bash
git clone https://github.com/lucaspretti/matomo-mcp-client
cd matomo-mcp-client
npm install
```

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and fill in your values:

| Variable | Required | Description |
|---|---|---|
| `MATOMO_HOST` | Yes | Your Matomo instance URL |
| `MATOMO_TOKEN_AUTH` | Yes | Matomo API token (Settings > Personal > Security > Auth Tokens) |
| `MATOMO_DEFAULT_SITE_ID` | No | Default site ID (default: 1) |
| `REQUEST_TIMEOUT` | No | Request timeout in ms (default: 30000) |
| `RETRY_COUNT` | No | Retry attempts (default: 3) |
| `RETRY_DELAY` | No | Initial retry delay in ms (default: 1000) |

### MCP Client Configuration

Add to your MCP client configuration (e.g., `claude_desktop_config.json`):

#### Docker

```json
{
  "mcpServers": {
    "matomo": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--env-file", "/absolute/path/to/.env",
        "matomo-mcp-server"
      ]
    }
  }
}
```

#### Node.js

```json
{
  "mcpServers": {
    "matomo": {
      "command": "node",
      "args": ["/absolute/path/to/matomo-mcp-client.js"],
      "env": {
        "MATOMO_HOST": "https://matomo.example.com",
        "MATOMO_TOKEN_AUTH": "your_token",
        "MATOMO_DEFAULT_SITE_ID": "1"
      }
    }
  }
}
```

Restart your MCP client after saving the configuration.

## Available Tools

### Traffic
| Tool | Description |
|---|---|
| `matomo_get_visits` | Visit summary: unique visitors, total visits, actions, bounce rate, avg time |
| `matomo_get_live_counters` | Real-time visitor counters for the last N minutes |
| `matomo_get_last_visits` | Detailed info on recent visits: pages, referrer, device, location |

### Pages
| Tool | Description |
|---|---|
| `matomo_get_top_pages` | Most visited page URLs with hits, time spent, load times |
| `matomo_get_page_titles` | Most visited pages by title |
| `matomo_get_entry_pages` | Top landing pages where visitors enter the site |
| `matomo_get_exit_pages` | Top exit pages where visitors leave the site |

### Site Search
| Tool | Description |
|---|---|
| `matomo_get_search_keywords` | Keywords searched on the site's internal search |
| `matomo_get_search_no_results` | Search keywords that returned no results (content gaps) |

### Performance
| Tool | Description |
|---|---|
| `matomo_get_page_performance` | Page load times: network, server, DOM processing, total |
| `matomo_get_devices` | Visitor device types: desktop, smartphone, tablet |
| `matomo_get_browsers` | Visitor browsers: Chrome, Firefox, Safari, Edge |

### Traffic Sources
| Tool | Description |
|---|---|
| `matomo_get_referrers` | Referring websites sending traffic |
| `matomo_get_search_engines` | Search engines: Google, Bing, DuckDuckGo |
| `matomo_get_ai_assistants` | AI assistants: ChatGPT, Perplexity, Claude, Gemini |
| `matomo_get_campaigns` | All traffic sources overview including campaigns |

## Common Parameters

Every time-based tool accepts the same scoping parameters:

| Param | Type | Description |
|---|---|---|
| `siteId` | number | Site ID. Falls back to `MATOMO_DEFAULT_SITE_ID`. |
| `period` | enum | `day`, `week`, `month`, `year`, or `range`. Default: `day`. |
| `date` | string | `today`, `yesterday`, `YYYY-MM-DD`, `last7`, `last30`, or `YYYY-MM-DD,YYYY-MM-DD` when `period=range`. |
| `limit` | number | Number of rows to return (default: 10 for most tools, 500 for `search_*`). |
| `segment` | string | Raw Matomo segment expression, e.g. `deviceType==smartphone` or `countryCode==de;browserCode==FF`. |
| `device` | enum | Sugar for the most common device segments. Combines with `segment` via AND. |

### `device` shortcuts

| Value | Expands to |
|---|---|
| `desktop` | `deviceType==desktop` |
| `mobile` | `deviceType==smartphone,deviceType==tablet,deviceType==phablet` |
| `smartphone` | `deviceType==smartphone` |
| `tablet` | `deviceType==tablet` |
| `phablet` | `deviceType==phablet` |

`mobile` bundles smartphone + tablet + phablet because most callers mean
"not desktop". Use `smartphone` if you need handheld only.

### Segment syntax

Matomo segments use `,` for OR and `;` for AND. A few useful ones:

- `deviceType==smartphone,deviceType==tablet` — mobile or tablet
- `countryCode==de;browserCode==FF` — German visitors using Firefox
- `pageUrl=@bulletin/download` — visits that saw any URL containing `bulletin/download`
- `visitorType==returning` — returning visitors only

Full reference: https://developer.matomo.org/api-reference/reporting-api-segmentation

### Segment archiving (important)

Matomo only returns aggregated metrics for a segment that has been **archived**
by the server. If your API token lacks the `process_new_segment` permission
and the segment isn't pre-archived, every reporting endpoint
(`VisitsSummary.get`, `Actions.getPageUrls`, etc.) silently returns **zero**
for every metric. This looks identical to "no traffic matched" but is
actually "the server refused to compute this on the fly".

If you pass `segment` / `device` and get empty results while an unsegmented
query returns data, you are hitting this. You have three options, in order of
effort:

1. **Use `Live.getLastVisitsDetails` instead** — the live API serves raw
   per-visit data and **does not require archiving**, so arbitrary segments
   work immediately. The downside: you get a list of visits, not a
   pre-aggregated number, so you need to count client-side. A dedicated
   `matomo_count_visits_by_segment` tool is planned for v1.7.5
   (see `ROADMAP.md`). Until then, call Matomo directly:

   ```bash
   curl -s -X POST "$MATOMO_HOST/index.php" \
     --data-urlencode "module=API" \
     --data-urlencode "method=Live.getLastVisitsDetails" \
     --data-urlencode "idSite=35" \
     --data-urlencode "period=month" --data-urlencode "date=2026-03-01" \
     --data-urlencode "segment=pageUrl=@bulletin/download;deviceType==smartphone,deviceType==tablet,deviceType==phablet" \
     --data-urlencode "filter_limit=-1" \
     --data-urlencode "format=JSON" \
     --data-urlencode "token_auth=$MATOMO_TOKEN_AUTH" \
     | jq 'length'
   ```

2. **Ask your Matomo admin** to either (a) grant `process_new_segment` on your
   token, (b) enable `enable_browser_archiving_triggering` for the site, or
   (c) pre-archive the common segments (device, country, etc.). This is the
   right fix if you rely heavily on segmented reporting.
3. **Fallback via the Matomo UI**: build the URL yourself and open it in a
   browser session that is logged in to Matomo — the UI uses the logged-in
   user's permissions, not the API token. Example:

   ```
   https://<your-matomo>/index.php?module=CoreHome&action=index
     &idSite=35&period=range&date=2025-04-24,2026-04-24
     &segment=deviceType%3D%3Dsmartphone%2CdeviceType%3D%3Dtablet%2CdeviceType%3D%3Dphablet
   ```

   Then navigate to Behaviour → Pages and filter by your URL pattern.

The MCP server itself is not limited, it faithfully forwards the segment to
Matomo. The restriction is entirely server-side and only affects the
aggregated reporting endpoints, not the Live API.

## Example Queries

- "Show me today's visit statistics"
- "What are the top 10 pages this week?"
- "How many visitors are online right now?"
- "What are people searching for on the site?"
- "Show me page load performance for the last month"
- "Which AI assistants are sending traffic?"
- "What are the top entry pages yesterday?"
- "How many mobile visits did `/bulletin/download` get in the last 12 months?"
- "Top pages for German visitors only, last 30 days"
- "Smartphone traffic share this quarter"

## Architecture

```
MCP Client (Claude Desktop/Code) <-> matomo-mcp-client (stdio) <-> Matomo API (HTTP POST)
```

1. MCP client sends tool calls via stdio
2. Server translates to Matomo API requests (POST with token in body)
3. Results returned as JSON to the MCP client

## Credits

Originally inspired by [Openmost's matomo-mcp-client](https://github.com/openmost/matomo-mcp-client). This version was rewritten to connect directly to the Matomo API without a remote proxy, with an expanded set of analytics tools.

## Resources

- [Model Context Protocol](https://modelcontextprotocol.io)
- [Matomo Analytics](https://matomo.org)
- [Matomo API Reference](https://developer.matomo.org/api-reference/reporting-api)
