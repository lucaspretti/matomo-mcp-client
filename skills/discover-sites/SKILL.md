---
name: discover-sites
description: List all available Matomo sites and let the user choose which one to analyze. Use this as a starting point when no site ID is known or when the user wants to pick a site.
---

# Discover Sites

Help the user find and select a Matomo site to work with.

1. Call `matomo_list_sites` to get all available sites.

2. Present the sites as a numbered list with:
   - Site ID
   - Name
   - URL
   - Creation date

3. Ask the user which site they want to analyze.

4. Once they pick a site, confirm the selection and remind them they can use the site ID with any other matomo-analytics skill, for example:
   - `/matomo-analytics:traffic-report` for a traffic overview
   - `/matomo-analytics:performance-diagnostic` for page load analysis
   - `/matomo-analytics:search-insights` for site search analysis

   Or they can ask any analytics question directly and specify the site ID.
