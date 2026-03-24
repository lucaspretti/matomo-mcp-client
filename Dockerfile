# Use Node.js LTS Alpine for smaller image size
FROM node:lts-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY matomo-mcp-client.js ./

# Create non-root user for security
RUN addgroup -g 1001 -S mcpuser && \
    adduser -S mcpuser -u 1001 && \
    chown -R mcpuser:mcpuser /app

# Switch to non-root user
USER mcpuser

# Expose that this runs in interactive mode (documentation only)
# No actual ports are exposed - uses stdio

# Set entrypoint to run the server
ENTRYPOINT ["node", "matomo-mcp-client.js"]
