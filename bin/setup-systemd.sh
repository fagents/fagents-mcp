#!/usr/bin/env bash
# Setup systemd service for fagents-mcp
set -euo pipefail

SERVICE_NAME="${1:-fagents-mcp}"
CWD="$(cd "$(dirname "$0")/.." && pwd)"

echo "Setting up systemd service: $SERVICE_NAME"
echo "Working directory: $CWD"

# Build first
echo "Building..."
cd "$CWD"
npm run build

# Create systemd unit
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=fagents-mcp — MCP server for fagents
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$CWD
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"

echo ""
echo "Service $SERVICE_NAME is running."
echo "  Status:  sudo systemctl status $SERVICE_NAME"
echo "  Logs:    journalctl -u $SERVICE_NAME -f"
echo "  Restart: sudo systemctl restart $SERVICE_NAME"
