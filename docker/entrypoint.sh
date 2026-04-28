#!/bin/bash
set -e

GHIDRA="${GHIDRA_INSTALL_DIR:-/opt/ghidra}"
PORT="${GHIDRA_MCP_PORT:-8089}"
BIND="${BIND_ADDRESS:-0.0.0.0}"

# Install extensions if any in /extensions
if [ -d /extensions ] && [ "$(ls -A /extensions 2>/dev/null)" ]; then
    /app/install-extensions.sh
fi

# Build classpath from ALL Ghidra JARs
CP="/app/ghidra-agent-mcp.jar"

# Include all JARs from Framework and Features modules
for jar in "$GHIDRA"/Ghidra/Framework/*/lib/*.jar \
           "$GHIDRA"/Ghidra/Features/*/lib/*.jar \
           "$GHIDRA"/Ghidra/Processors/*/lib/*.jar \
           "$GHIDRA"/Ghidra/Extensions/*/lib/*.jar; do
    [ -f "$jar" ] && CP="$CP:$jar"
done

# Patch directory for native libraries (decompiler)
PATCH_DIR="$GHIDRA/Ghidra/Features/Decompiler/os/linux_x86_64"
export LD_LIBRARY_PATH="${PATCH_DIR}:${LD_LIBRARY_PATH:-}"

echo "=== Ghidra Agent MCP Server ==="
echo "Port: $PORT"
echo "Bind: $BIND"
echo "Ghidra: $GHIDRA"
echo "Auto-import: ${AUTO_IMPORT:-false}"
echo "=============================="

exec java \
    -Xmx2g \
    -Dghidra.install.dir="$GHIDRA" \
    -Dghidra.mcp.port="$PORT" \
    -Dghidra.mcp.bind="$BIND" \
    -Dauto.import="${AUTO_IMPORT:-false}" \
    -cp "$CP" \
    GhidraAgentMcpServer \
    --port "$PORT" \
    --bind "$BIND"
