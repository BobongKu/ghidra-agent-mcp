#!/bin/bash
set -e

echo ""
echo "=== ghidra-agent-mcp setup ==="
echo ""

# Check prerequisites
check_cmd() {
    if ! command -v "$1" &>/dev/null; then
        echo "[ERROR] $1 is not installed. $2"
        exit 1
    fi
}

check_cmd docker "Install Docker: https://docs.docker.com/get-docker/"
check_cmd python3 "Install Python 3.10+: https://www.python.org/downloads/"

# Check Docker is running
if ! docker info &>/dev/null; then
    echo "[ERROR] Docker is not running. Start Docker Desktop first."
    exit 1
fi

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# Step 1: Install Python dependencies
echo "[1/3] Installing Python dependencies..."
python3 -m pip install -r requirements.txt --quiet

# Step 2: Build and start Docker container
echo "[2/3] Building Docker image (first run takes a few minutes)..."
docker compose -f docker/docker-compose.yml up -d --build

# Step 3: Wait for server
echo "[3/3] Waiting for server..."
MAX_WAIT=120
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
    if curl -s http://127.0.0.1:18089/health | grep -q '"ok"' 2>/dev/null; then
        echo ""
        echo "=== Setup complete! ==="
        echo ""
        echo "Server:  http://127.0.0.1:18089"
        echo ""
        echo "Usage:"
        echo "  1. Put binaries in docker/binaries/"
        echo "  2. Connect via MCP:"
        echo "     Claude Code: .mcp.json already configured (restart Claude Code)"
        echo "     Claude Desktop: copy .mcp.json config to claude_desktop_config.json"
        echo "     Other: python3 bridge_lite.py"
        echo ""
        exit 0
    fi
    sleep 3
    ELAPSED=$((ELAPSED + 3))
    echo "  ... waiting (${ELAPSED}s)"
done

echo "[ERROR] Server did not start within ${MAX_WAIT}s"
echo "Check logs: docker compose -f docker/docker-compose.yml logs -f"
exit 1
