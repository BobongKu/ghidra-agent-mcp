FROM eclipse-temurin:21-jre

ARG GHIDRA_VERSION=12.0.3
ARG GHIDRA_DATE=20260210

# Download and extract Ghidra
RUN apt-get update && apt-get install -y wget unzip && \
    wget -q "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_${GHIDRA_VERSION}_build/ghidra_${GHIDRA_VERSION}_PUBLIC_${GHIDRA_DATE}.zip" \
         -O /tmp/ghidra.zip && \
    unzip -q /tmp/ghidra.zip -d /opt && \
    mv /opt/ghidra_${GHIDRA_VERSION}_PUBLIC /opt/ghidra && \
    rm /tmp/ghidra.zip && \
    apt-get remove -y wget unzip && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# Copy pre-built JAR
COPY docker/ghidra-agent-mcp.jar /app/ghidra-agent-mcp.jar

# Copy entrypoint and extension installer
COPY docker/entrypoint.sh /app/entrypoint.sh
COPY docker/install-extensions.sh /app/install-extensions.sh
RUN chmod +x /app/entrypoint.sh /app/install-extensions.sh

# Create directories
RUN mkdir -p /binaries /data

ENV GHIDRA_INSTALL_DIR=/opt/ghidra
ENV GHIDRA_MCP_PORT=8089
ENV BIND_ADDRESS=0.0.0.0
ENV AUTO_IMPORT=false

VOLUME ["/binaries", "/data"]
EXPOSE 8089

ENTRYPOINT ["/app/entrypoint.sh"]
