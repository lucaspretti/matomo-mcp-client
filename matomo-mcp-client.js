#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';
import https from 'node:https';

// Allow self-signed certificates (common for internal servers)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Configuration from arguments or environment variables
const args = process.argv.slice(2);
const config = {
    matomoHost: args.find(arg => arg.startsWith('--matomo-host='))?.split('=')[1] ||
        process.env.MATOMO_HOST,

    matomoToken: args.find(arg => arg.startsWith('--matomo-token='))?.split('=')[1] ||
        process.env.MATOMO_TOKEN_AUTH,

    defaultSiteId: args.find(arg => arg.startsWith('--default-site='))?.split('=')[1] ||
        process.env.MATOMO_DEFAULT_SITE_ID ||
        '1',

    timeout: parseInt(args.find(arg => arg.startsWith('--timeout='))?.split('=')[1]) ||
        parseInt(process.env.REQUEST_TIMEOUT) ||
        30000,

    retryCount: parseInt(args.find(arg => arg.startsWith('--retry='))?.split('=')[1]) ||
        parseInt(process.env.RETRY_COUNT) ||
        3,

    retryDelay: parseInt(args.find(arg => arg.startsWith('--retry-delay='))?.split('=')[1]) ||
        parseInt(process.env.RETRY_DELAY) ||
        1000
};

// Configuration validation
function validateConfig() {
    const errors = [];

    if (!config.matomoHost) {
        errors.push('MATOMO_HOST is required. Use --matomo-host=YOUR_HOST or set environment variable');
    }

    if (!config.matomoToken) {
        errors.push('MATOMO_TOKEN_AUTH is required. Use --matomo-token=YOUR_TOKEN or set environment variable');
    }

    if (config.matomoHost) {
        try {
            new URL(config.matomoHost);
        } catch (error) {
            errors.push(`Invalid MATOMO_HOST URL: ${config.matomoHost}`);
        }
    }

    return errors;
}

console.error('Matomo MCP Server configuration:', {
    matomoHost: config.matomoHost,
    matomoToken: config.matomoToken ? '***' : 'NOT SET',
    defaultSiteId: config.defaultSiteId,
    timeout: config.timeout,
    retryCount: config.retryCount
});

// ============================================================================
// MATOMO API CLIENT
// ============================================================================

async function callMatomoAPI(method, params = {}) {
    const baseUrl = config.matomoHost.replace(/\/$/, '');
    const url = `${baseUrl}/index.php`;
    const requestId = `matomo-${method}-${Date.now()}`;

    const body = new URLSearchParams({
        module: 'API',
        method: method,
        format: 'JSON',
        token_auth: config.matomoToken,
        ...params
    });

    console.error(`[${requestId}] Calling Matomo API: ${method}`);

    let lastError;

    for (let attempt = 1; attempt <= config.retryCount; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.timeout);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Matomo-MCP-Server/2.0'
                },
                body: body,
                agent: httpsAgent,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
            }

            const result = await response.json();

            if (result.result === 'error') {
                throw new Error(`Matomo API error: ${result.message || 'Unknown error'}`);
            }

            return result;

        } catch (error) {
            lastError = error;

            if (error.name === 'AbortError') {
                console.error(`[${requestId}] Timeout after ${config.timeout}ms (attempt ${attempt}/${config.retryCount})`);
            } else {
                console.error(`[${requestId}] Attempt ${attempt}/${config.retryCount} failed: ${error.message}`);
            }

            if (error.message.includes('401') || error.message.includes('403') || error.message.includes('token_auth')) {
                break;
            }

            if (attempt < config.retryCount) {
                const delay = config.retryDelay * Math.pow(2, attempt - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw new Error(`Matomo API call failed after ${config.retryCount} attempts: ${lastError.message}`);
}

// Helper to build standard response
function jsonResponse(data) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// Filter response data to keep only specified fields.
// Matomo returns either an array or an object with date keys mapping to arrays.
function filterResponseFields(data, fields) {
    const pick = (row) => {
        const out = {};
        for (const f of fields) {
            if (f in row) out[f] = row[f];
        }
        return out;
    };

    if (Array.isArray(data)) {
        return data.map(pick);
    }

    if (data && typeof data === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(data)) {
            result[key] = Array.isArray(value) ? value.map(pick) : value;
        }
        return result;
    }

    return data;
}

// Sugar mapping device shortcuts to Matomo segment expressions.
// `mobile` intentionally bundles smartphone + tablet + phablet since most callers
// mean "not desktop" rather than strictly handheld.
const DEVICE_SEGMENTS = {
    desktop: 'deviceType==desktop',
    mobile: 'deviceType==smartphone,deviceType==tablet,deviceType==phablet',
    smartphone: 'deviceType==smartphone',
    tablet: 'deviceType==tablet',
    phablet: 'deviceType==phablet'
};

// Build a Matomo segment string from explicit `segment` + `device` sugar.
// Segments combine with AND (`;`); values inside one segment OR with `,`.
function resolveSegment(args) {
    const parts = [];
    if (args.segment) parts.push(args.segment);
    if (args.device && DEVICE_SEGMENTS[args.device]) {
        parts.push(DEVICE_SEGMENTS[args.device]);
    }
    return parts.length ? parts.join(';') : undefined;
}

// Common params extraction
function commonParams(args) {
    const params = {
        idSite: args.siteId || config.defaultSiteId,
        period: args.period || 'day',
        date: args.date || 'today'
    };
    const segment = resolveSegment(args);
    if (segment) params.segment = segment;
    // Server-side response shaping (passthrough)
    if (args.hideColumns) params.hideColumns = args.hideColumns;
    if (args.showColumns) params.showColumns = args.showColumns;
    if (args.filter_offset !== undefined) params.filter_offset = args.filter_offset;
    if (args.filter_truncate !== undefined) params.filter_truncate = args.filter_truncate;
    if (args.format_metrics === false) params.format_metrics = 0;
    return params;
}

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

const toolHandlers = {
    // --- Discovery ---
    async matomo_list_sites() {
        const data = await callMatomoAPI('SitesManager.getSitesWithAtLeastViewAccess');
        return jsonResponse(data);
    },

    // --- Traffic ---
    async matomo_get_visits(args) {
        const data = await callMatomoAPI('VisitsSummary.get', commonParams(args));
        return jsonResponse(data);
    },

    async matomo_get_live_counters(args) {
        const data = await callMatomoAPI('Live.getCounters', {
            idSite: args.siteId || config.defaultSiteId,
            lastMinutes: args.lastMinutes || 30
        });
        return jsonResponse(data);
    },

    async matomo_get_last_visits(args) {
        // Live.getLastVisitsDetails: accepts period/date/segment. When none are
        // provided, returns the most recent N visits (the original behaviour).
        const params = { idSite: args.siteId || config.defaultSiteId };
        if (args.period) params.period = args.period;
        if (args.date) params.date = args.date;
        const seg = resolveSegment(args);
        if (seg) params.segment = seg;
        params.filter_limit = args.limit || 10;
        if (args.filter_offset !== undefined) params.filter_offset = args.filter_offset;
        if (args.doNotFetchActions) params.doNotFetchActions = 1;
        const data = await callMatomoAPI('Live.getLastVisitsDetails', params);
        return jsonResponse(data);
    },

    // Count visits via Live API. Bypasses the "segment not archived" trap
    // because Live.getLastVisitsDetails reads raw per-visit data that does not
    // depend on pre-computed segment archives. Optionally filters client-side
    // by a URL regex, then returns an aggregate (total + device + country).
    async matomo_count_visits_by_segment(args) {
        const params = {
            idSite: args.siteId || config.defaultSiteId,
            period: args.period || 'month',
            date: args.date || 'last30',
            filter_limit: -1
        };
        const seg = resolveSegment(args);
        if (seg) params.segment = seg;
        // doNotFetchActions halves payload + latency. We only need actions
        // when the caller wants to post-filter by URL pattern.
        if (!args.urlPattern) params.doNotFetchActions = 1;
        const visits = await callMatomoAPI('Live.getLastVisitsDetails', params);
        if (!Array.isArray(visits)) {
            return jsonResponse({ error: 'Unexpected response', data: visits });
        }

        const byDevice = {};
        const byCountry = {};
        const urlRegex = args.urlPattern ? new RegExp(args.urlPattern) : null;
        let matched = 0;
        let actionHits = 0;
        for (const v of visits) {
            if (urlRegex) {
                const hits = (v.actionDetails || []).filter(
                    a => a && a.url && urlRegex.test(a.url)
                );
                if (hits.length === 0) continue;
                actionHits += hits.length;
            }
            matched++;
            const dt = v.deviceType || 'unknown';
            byDevice[dt] = (byDevice[dt] || 0) + 1;
            const cc = v.countryCode || 'unknown';
            byCountry[cc] = (byCountry[cc] || 0) + 1;
        }
        const sortedCountry = Object.fromEntries(
            Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 10)
        );
        return jsonResponse({
            visits: matched,
            byDevice,
            byCountryTop10: sortedCountry,
            ...(urlRegex ? { actionHitsOnPattern: actionHits, rawVisitsInSegment: visits.length } : {}),
            note: 'Counted client-side from Live.getLastVisitsDetails. No segment archiving required.'
        });
    },

    // Bulk request: one HTTP call bundling multiple API methods. Saves N-1
    // round-trips when a skill needs several reports (traffic-report etc.).
    // `calls` is an array of {method, params?}. Returns an array of results
    // in the same order.
    async matomo_batch(args) {
        if (!Array.isArray(args.calls) || args.calls.length === 0) {
            throw new Error('matomo_batch requires a non-empty `calls` array');
        }
        const subParams = {};
        args.calls.forEach((call, i) => {
            if (!call || !call.method) {
                throw new Error(`calls[${i}].method is required`);
            }
            const sub = new URLSearchParams({
                method: call.method,
                ...(call.params || {})
            });
            subParams[`urls[${i}]`] = sub.toString();
        });
        const data = await callMatomoAPI('API.getBulkRequest', subParams);
        return jsonResponse(data);
    },

    // Time-series for a specific row label (e.g. daily visits for one URL
    // over 30 days). Wraps API.getRowEvolution. apiModule/apiAction pick
    // which report to evolve, label is the row's label in that report.
    async matomo_get_row_evolution(args) {
        if (!args.apiModule || !args.apiAction || !args.label) {
            throw new Error('apiModule, apiAction and label are required');
        }
        const params = {
            idSite: args.siteId || config.defaultSiteId,
            period: args.period || 'day',
            date: args.date || 'last30',
            apiModule: args.apiModule,
            apiAction: args.apiAction,
            label: args.label
        };
        const seg = resolveSegment(args);
        if (seg) params.segment = seg;
        if (args.idSubtable !== undefined) params.idSubtable = args.idSubtable;
        if (args.column) params.column = args.column;
        const data = await callMatomoAPI('API.getRowEvolution', params);
        return jsonResponse(data);
    },

    // Lists pre-defined segments the Matomo instance knows about. Critical
    // for picking segments that will actually return data: segments with
    // auto_archive=1 work regardless of process_new_segment permission; ad-hoc
    // segment strings do NOT on locked-down tokens.
    async matomo_list_segments(args) {
        const params = {};
        if (args.siteId) params.idSite = args.siteId;
        const data = await callMatomoAPI('SegmentEditor.getAll', params);
        return jsonResponse(data);
    },

    // --- Pages ---
    async matomo_get_top_pages(args) {
        const data = await callMatomoAPI('Actions.getPageUrls', {
            ...commonParams(args),
            filter_limit: args.limit || 10
        });
        return jsonResponse(data);
    },

    async matomo_get_page_titles(args) {
        const data = await callMatomoAPI('Actions.getPageTitles', {
            ...commonParams(args),
            filter_limit: args.limit || 10
        });
        return jsonResponse(data);
    },

    async matomo_get_entry_pages(args) {
        const data = await callMatomoAPI('Actions.getEntryPageUrls', {
            ...commonParams(args),
            filter_limit: args.limit || 10
        });
        return jsonResponse(data);
    },

    async matomo_get_exit_pages(args) {
        const data = await callMatomoAPI('Actions.getExitPageUrls', {
            ...commonParams(args),
            filter_limit: args.limit || 10
        });
        return jsonResponse(data);
    },

    // --- Site Search ---
    async matomo_get_search_keywords(args) {
        const data = await callMatomoAPI('Actions.getSiteSearchKeywords', {
            ...commonParams(args),
            filter_limit: args.limit || 10
        });
        return jsonResponse(data);
    },

    async matomo_get_search_no_results(args) {
        const data = await callMatomoAPI('Actions.getSiteSearchNoResultKeywords', {
            ...commonParams(args),
            filter_limit: args.limit || 10
        });
        return jsonResponse(data);
    },

    // --- Performance ---
    async matomo_get_page_performance(args) {
        const data = await callMatomoAPI('PagePerformance.get', commonParams(args));
        return jsonResponse(data);
    },

    async matomo_get_devices(args) {
        const data = await callMatomoAPI('DevicesDetection.getType', {
            ...commonParams(args),
            filter_limit: args.limit || 10
        });
        return jsonResponse(data);
    },

    async matomo_get_browsers(args) {
        const data = await callMatomoAPI('DevicesDetection.getBrowsers', {
            ...commonParams(args),
            filter_limit: args.limit || 10
        });
        return jsonResponse(data);
    },

    // --- Traffic Sources ---
    async matomo_get_referrers(args) {
        const data = await callMatomoAPI('Referrers.getWebsites', {
            ...commonParams(args),
            filter_limit: args.limit || 10
        });
        return jsonResponse(data);
    },

    async matomo_get_search_engines(args) {
        const data = await callMatomoAPI('Referrers.getSearchEngines', {
            ...commonParams(args),
            filter_limit: args.limit || 10
        });
        return jsonResponse(data);
    },

    async matomo_get_ai_assistants(args) {
        const data = await callMatomoAPI('Referrers.getAIAssistants', {
            ...commonParams(args),
            filter_limit: args.limit || 10
        });
        return jsonResponse(data);
    },

    async matomo_get_campaigns(args) {
        const data = await callMatomoAPI('Referrers.getAll', {
            ...commonParams(args),
            filter_limit: args.limit || 10
        });
        return jsonResponse(data);
    },

    // --- Filtered Search ---
    async matomo_search_pages(args) {
        const params = {
            ...commonParams(args),
            flat: 1,
            filter_limit: args.limit || 500
        };
        if (args.urlPattern) {
            params.filter_pattern = args.urlPattern;
        }
        const data = await callMatomoAPI('Actions.getPageUrls', params);
        const filtered = filterResponseFields(data, [
            'label', 'nb_visits', 'nb_hits', 'avg_time_on_page', 'bounce_rate', 'exit_rate'
        ]);
        return jsonResponse(filtered);
    },

    async matomo_search_events(args) {
        const method = args.dimension === 'name' ? 'Events.getName'
            : args.dimension === 'category' ? 'Events.getCategory'
            : 'Events.getAction';
        const params = {
            ...commonParams(args),
            flat: 1,
            filter_limit: args.limit || 500
        };
        if (args.filterPattern) {
            params.filter_pattern = args.filterPattern;
        }
        const data = await callMatomoAPI(method, params);
        const filtered = filterResponseFields(data, [
            'label', 'nb_uniq_visitors', 'nb_visits', 'nb_events',
            'Events_EventName', 'Events_EventAction', 'Events_EventCategory',
            'sum_daily_nb_uniq_visitors'
        ]);
        return jsonResponse(filtered);
    }
};

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

const periodDateProps = {
    period: {
        type: "string",
        enum: ["day", "week", "month", "year", "range"],
        description: "Time period (default: day). Use 'range' with date=YYYY-MM-DD,YYYY-MM-DD for custom windows."
    },
    date: {
        type: "string",
        description: "Date: today, yesterday, YYYY-MM-DD, last7, last30, or YYYY-MM-DD,YYYY-MM-DD when period=range (default: today)"
    }
};

const siteIdProp = {
    siteId: {
        type: "number",
        description: "Site ID (uses default from config if not provided)"
    }
};

const limitProp = {
    limit: {
        type: "number",
        description: "Number of results to return (default: 10)"
    }
};

const segmentProps = {
    segment: {
        type: "string",
        description: "Raw Matomo segment expression, e.g. 'deviceType==smartphone' or 'countryCode==de;browserCode==FF'. Combines with `device` sugar via AND."
    },
    device: {
        type: "string",
        enum: ["desktop", "mobile", "smartphone", "tablet", "phablet"],
        description: "Shortcut for the most common device segments. 'mobile' covers smartphone + tablet + phablet."
    }
};

// Server-side response shaping. Applied before bytes leave Matomo, so they
// reduce bandwidth and parsing cost on the MCP side. Honoured on every
// time-based tool.
const shapingProps = {
    hideColumns: {
        type: "string",
        description: "Comma-separated list of column names to exclude from the response. Server-side. Example: 'nb_hits,avg_time_on_page'."
    },
    showColumns: {
        type: "string",
        description: "Comma-separated list of column names to keep (all others dropped). Server-side."
    },
    filter_offset: {
        type: "number",
        description: "Row offset for pagination. Use with `limit` to page past the first N rows."
    },
    filter_truncate: {
        type: "number",
        description: "Truncate the report after N rows, merging the tail into an 'Others' summary row. Useful for long-tail reports."
    },
    format_metrics: {
        type: "boolean",
        description: "Default true: metrics come pre-formatted (e.g. '56%'). Set false to get raw numbers (0.56) for easier processing."
    }
};

const TOOLS = [
    // --- Discovery ---
    {
        name: "matomo_list_sites",
        description: "List all sites in the Matomo instance with their IDs, names, URLs, and settings. Use this first to discover available site IDs.",
        inputSchema: { type: "object", properties: {} }
    },

    // --- Traffic ---
    {
        name: "matomo_get_visits",
        description: "Get visits summary: unique visitors, total visits, actions, bounce rate, avg time on site",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...segmentProps, ...shapingProps } }
    },
    {
        name: "matomo_get_live_counters",
        description: "Get real-time visitor counters for the last N minutes",
        inputSchema: {
            type: "object",
            properties: {
                ...siteIdProp,
                lastMinutes: { type: "number", description: "Minutes to look back (default: 30)" }
            }
        }
    },
    {
        name: "matomo_get_last_visits",
        description: "Get detailed info on recent visits: pages viewed, referrer, device, location, duration. Accepts period/date/segment/device for historical slices. Set doNotFetchActions=true to skip per-page details (faster, smaller).",
        inputSchema: {
            type: "object",
            properties: {
                ...siteIdProp,
                ...periodDateProps,
                ...limitProp,
                ...segmentProps,
                filter_offset: {
                    type: "number",
                    description: "Row offset for pagination (use with `limit` to walk large result sets)."
                },
                doNotFetchActions: {
                    type: "boolean",
                    description: "Skip fetching per-visit actionDetails (page views inside each visit). Halves response size and latency when you only need visit-level info."
                }
            }
        }
    },

    // --- Pages ---
    {
        name: "matomo_get_top_pages",
        description: "Get most visited page URLs with hits, time spent, bounce/exit rates, and load times",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp, ...segmentProps, ...shapingProps } }
    },
    {
        name: "matomo_get_page_titles",
        description: "Get most visited pages by title (useful when URLs are not descriptive)",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp, ...segmentProps, ...shapingProps } }
    },
    {
        name: "matomo_get_entry_pages",
        description: "Get top landing pages where visitors enter the site",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp, ...segmentProps, ...shapingProps } }
    },
    {
        name: "matomo_get_exit_pages",
        description: "Get top exit pages where visitors leave the site",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp, ...segmentProps, ...shapingProps } }
    },

    // --- Site Search ---
    {
        name: "matomo_get_search_keywords",
        description: "Get keywords visitors searched for on the site's internal search",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp, ...segmentProps, ...shapingProps } }
    },
    {
        name: "matomo_get_search_no_results",
        description: "Get search keywords that returned no results (content gaps)",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp, ...segmentProps, ...shapingProps } }
    },

    // --- Performance ---
    {
        name: "matomo_get_page_performance",
        description: "Get page load performance: network, server, transfer, DOM processing, and total load times",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...segmentProps, ...shapingProps } }
    },
    {
        name: "matomo_get_devices",
        description: "Get visitor device types: desktop, smartphone, tablet, etc.",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp, ...segmentProps, ...shapingProps } }
    },
    {
        name: "matomo_get_browsers",
        description: "Get visitor browsers: Chrome, Firefox, Safari, Edge, etc.",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp, ...segmentProps, ...shapingProps } }
    },

    // --- Traffic Sources ---
    {
        name: "matomo_get_referrers",
        description: "Get referring websites that send traffic to your site",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp, ...segmentProps, ...shapingProps } }
    },
    {
        name: "matomo_get_search_engines",
        description: "Get search engines driving traffic: Google, Bing, DuckDuckGo, etc.",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp, ...segmentProps, ...shapingProps } }
    },
    {
        name: "matomo_get_ai_assistants",
        description: "Get AI assistants driving traffic: ChatGPT, Perplexity, Claude, etc.",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp, ...segmentProps, ...shapingProps } }
    },
    {
        name: "matomo_get_campaigns",
        description: "Get all traffic sources overview including campaigns, search, social, direct",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp, ...segmentProps, ...shapingProps } }
    },

    // --- Filtered Search ---
    {
        name: "matomo_search_pages",
        description: "Search page URLs with regex pattern filtering. Returns flat list of matching pages with visits, hits, time spent, bounce/exit rates. Use this to find specific pages by URL path (e.g. 'guidelines-epc', 'patent/search'). Supports `segment` and `device` for slicing (e.g. device='mobile').",
        inputSchema: {
            type: "object",
            properties: {
                ...siteIdProp,
                ...periodDateProps,
                ...segmentProps, ...shapingProps,
                limit: {
                    type: "number",
                    description: "Number of results to return (default: 500)"
                },
                urlPattern: {
                    type: "string",
                    description: "Regex pattern to filter page URLs (e.g. 'guidelines-epc|guidelines-pct')"
                }
            }
        }
    },
    {
        name: "matomo_search_events",
        description: "Search events with optional regex pattern filtering. Returns flat list of events with counts and values. Use dimension to search by action (default), category, or name. Supports `segment` and `device` for slicing.",
        inputSchema: {
            type: "object",
            properties: {
                ...siteIdProp,
                ...periodDateProps,
                ...segmentProps, ...shapingProps,
                limit: {
                    type: "number",
                    description: "Number of results to return (default: 500)"
                },
                dimension: {
                    type: "string",
                    enum: ["action", "category", "name"],
                    description: "Event dimension to search (default: action)"
                },
                filterPattern: {
                    type: "string",
                    description: "Regex pattern to filter events (e.g. 'click|download')"
                }
            }
        }
    },

    // --- Segment-aware counting (Live API, bypasses archiving) ---
    {
        name: "matomo_count_visits_by_segment",
        description: "Count visits matching a segment (incl. device filters) without needing segment archiving. Uses Live.getLastVisitsDetails under the hood, so it works even when the API token lacks `process_new_segment`. Returns {visits, byDevice, byCountryTop10}. Pass `urlPattern` to count only visits that saw a URL matching the regex. Slower than aggregate endpoints for large result sets, but always returns real numbers.",
        inputSchema: {
            type: "object",
            properties: {
                ...siteIdProp,
                ...periodDateProps,
                ...segmentProps,
                urlPattern: {
                    type: "string",
                    description: "Optional regex applied client-side to actionDetails[].url. Filters visits that didn't see any matching page."
                }
            }
        }
    },

    // --- Bulk batching ---
    {
        name: "matomo_batch",
        description: "Execute multiple Matomo API methods in one HTTP request via API.getBulkRequest. Great for generating multi-panel reports (e.g. traffic-report needs 6+ tools — batch them). Returns an array of results in the same order as the input `calls`.",
        inputSchema: {
            type: "object",
            properties: {
                calls: {
                    type: "array",
                    description: "Array of {method, params} objects. Each `method` is a Matomo API method name (e.g. 'VisitsSummary.get'). Params follow the same shape that method expects (idSite, period, date, segment, etc.).",
                    items: {
                        type: "object",
                        properties: {
                            method: { type: "string" },
                            params: { type: "object" }
                        },
                        required: ["method"]
                    }
                }
            },
            required: ["calls"]
        }
    },

    // --- Row evolution (time series of a single row) ---
    {
        name: "matomo_get_row_evolution",
        description: "Get the time series of a specific row in a report (e.g. daily visits for one URL over 30 days). Pick which report to evolve via apiModule+apiAction (e.g. 'Actions'+'getPageUrls') and the row via `label`. Supports segment/device.",
        inputSchema: {
            type: "object",
            properties: {
                ...siteIdProp,
                ...periodDateProps,
                ...segmentProps,
                apiModule: {
                    type: "string",
                    description: "Report module, e.g. 'Actions', 'Referrers', 'UserCountry'."
                },
                apiAction: {
                    type: "string",
                    description: "Report method, e.g. 'getPageUrls', 'getWebsites', 'getCountry'."
                },
                label: {
                    type: "string",
                    description: "Row label to track. For pages, this is the URL path; for countries, the country code; etc."
                },
                idSubtable: {
                    type: "number",
                    description: "Subtable ID if the row is inside a nested report."
                },
                column: {
                    type: "string",
                    description: "Restrict the evolution to a single metric column, e.g. 'nb_visits'."
                }
            },
            required: ["apiModule", "apiAction", "label"]
        }
    },

    // --- Segment discovery ---
    {
        name: "matomo_list_segments",
        description: "List the pre-defined (saved) segments the Matomo instance knows about. Segments with auto_archive=1 are pre-archived and always return data — any other ad-hoc segment may silently return zero on tokens without `process_new_segment`. Use this first when the user asks for segment-based slicing to pick a segment that will work.",
        inputSchema: {
            type: "object",
            properties: {
                ...siteIdProp
            }
        }
    }
];

// ============================================================================
// MCP SERVER
// ============================================================================

const server = new Server(
    { name: 'matomo-mcp-server', version: '2.0.0' },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.error(`Listing ${TOOLS.length} tools`);
    return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = toolHandlers[name];

    if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
    }

    console.error(`Calling tool: ${name}`);
    return handler(args || {});
});

// ============================================================================
// STARTUP
// ============================================================================

async function main() {
    if (args.includes('--help') || args.includes('-h')) {
        console.error(`
Matomo MCP Server - Direct connection to Matomo Analytics API

Usage: node matomo-mcp-client.js [options]

Options:
  --matomo-host=URL         Matomo instance URL (required)
  --matomo-token=TOKEN      Matomo API token (required)
  --default-site=ID         Default site ID (default: 1)
  --timeout=MS              Request timeout in ms (default: 30000)
  --retry=COUNT             Retry attempts (default: 3)
  --retry-delay=MS          Initial retry delay in ms (default: 1000)
  --help                    Show this help

Environment variables:
  MATOMO_HOST               Matomo instance URL
  MATOMO_TOKEN_AUTH         Matomo API token
  MATOMO_DEFAULT_SITE_ID    Default site ID
  REQUEST_TIMEOUT           Request timeout in ms
  RETRY_COUNT               Retry attempts
  RETRY_DELAY               Initial retry delay in ms
`);
        process.exit(0);
    }

    const configErrors = validateConfig();
    if (configErrors.length > 0) {
        console.error('Configuration errors:');
        configErrors.forEach(error => console.error(`  - ${error}`));
        console.error('\nUse --help for usage information');
        process.exit(1);
    }

    console.error(`Starting Matomo MCP Server | ${config.matomoHost} | ${TOOLS.length} tools`);

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Matomo MCP Server ready');
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('uncaughtException', error => { console.error('Uncaught exception:', error); process.exit(1); });
process.on('unhandledRejection', reason => { console.error('Unhandled rejection:', reason); process.exit(1); });

main().catch(error => { console.error('Fatal error:', error.message); process.exit(1); });
