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

// Common params extraction
function commonParams(args) {
    return {
        idSite: args.siteId || config.defaultSiteId,
        period: args.period || 'day',
        date: args.date || 'today'
    };
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
        const data = await callMatomoAPI('Live.getLastVisitsDetails', {
            idSite: args.siteId || config.defaultSiteId,
            filter_limit: args.limit || 10
        });
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
        enum: ["day", "week", "month", "year"],
        description: "Time period (default: day)"
    },
    date: {
        type: "string",
        description: "Date: today, yesterday, YYYY-MM-DD, last7, last30 (default: today)"
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
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps } }
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
        description: "Get detailed info on recent visits: pages viewed, referrer, device, location, duration",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...limitProp } }
    },

    // --- Pages ---
    {
        name: "matomo_get_top_pages",
        description: "Get most visited page URLs with hits, time spent, bounce/exit rates, and load times",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp } }
    },
    {
        name: "matomo_get_page_titles",
        description: "Get most visited pages by title (useful when URLs are not descriptive)",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp } }
    },
    {
        name: "matomo_get_entry_pages",
        description: "Get top landing pages where visitors enter the site",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp } }
    },
    {
        name: "matomo_get_exit_pages",
        description: "Get top exit pages where visitors leave the site",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp } }
    },

    // --- Site Search ---
    {
        name: "matomo_get_search_keywords",
        description: "Get keywords visitors searched for on the site's internal search",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp } }
    },
    {
        name: "matomo_get_search_no_results",
        description: "Get search keywords that returned no results (content gaps)",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp } }
    },

    // --- Performance ---
    {
        name: "matomo_get_page_performance",
        description: "Get page load performance: network, server, transfer, DOM processing, and total load times",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps } }
    },
    {
        name: "matomo_get_devices",
        description: "Get visitor device types: desktop, smartphone, tablet, etc.",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp } }
    },
    {
        name: "matomo_get_browsers",
        description: "Get visitor browsers: Chrome, Firefox, Safari, Edge, etc.",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp } }
    },

    // --- Traffic Sources ---
    {
        name: "matomo_get_referrers",
        description: "Get referring websites that send traffic to your site",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp } }
    },
    {
        name: "matomo_get_search_engines",
        description: "Get search engines driving traffic: Google, Bing, DuckDuckGo, etc.",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp } }
    },
    {
        name: "matomo_get_ai_assistants",
        description: "Get AI assistants driving traffic: ChatGPT, Perplexity, Claude, etc.",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp } }
    },
    {
        name: "matomo_get_campaigns",
        description: "Get all traffic sources overview including campaigns, search, social, direct",
        inputSchema: { type: "object", properties: { ...siteIdProp, ...periodDateProps, ...limitProp } }
    },

    // --- Filtered Search ---
    {
        name: "matomo_search_pages",
        description: "Search page URLs with regex pattern filtering. Returns flat list of matching pages with visits, hits, time spent, bounce/exit rates. Use this to find specific pages by URL path (e.g. 'guidelines-epc', 'patent/search').",
        inputSchema: {
            type: "object",
            properties: {
                ...siteIdProp,
                ...periodDateProps,
                period: {
                    type: "string",
                    enum: ["day", "week", "month", "year", "range"],
                    description: "Time period. Use 'range' with date=YYYY-MM-DD,YYYY-MM-DD (default: day)"
                },
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
        description: "Search events with optional regex pattern filtering. Returns flat list of events with counts and values. Use dimension to search by action (default), category, or name.",
        inputSchema: {
            type: "object",
            properties: {
                ...siteIdProp,
                ...periodDateProps,
                period: {
                    type: "string",
                    enum: ["day", "week", "month", "year", "range"],
                    description: "Time period. Use 'range' with date=YYYY-MM-DD,YYYY-MM-DD (default: day)"
                },
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
