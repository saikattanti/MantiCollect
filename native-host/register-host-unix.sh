#!/bin/sh
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="com.mantitup.manticollect"
CHROME_MANIFEST="$DIR/$HOST_NAME.json"

if [ "$(uname)" = "Darwin" ]; then
  # macOS
  CHROME_TARGET="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json"
  EDGE_TARGET="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts/$HOST_NAME.json"
else
  # Linux
  CHROME_TARGET="$HOME/.config/google-chrome/NativeMessagingHosts/$HOST_NAME.json"
  EDGE_TARGET="$HOME/.config/microsoft-edge/NativeMessagingHosts/$HOST_NAME.json"
fi

mkdir -p "$(dirname "$CHROME_TARGET")"
cp "$CHROME_MANIFEST" "$CHROME_TARGET"
echo "Registered Chrome host at: $CHROME_TARGET"

mkdir -p "$(dirname "$EDGE_TARGET")"
cp "$CHROME_MANIFEST" "$EDGE_TARGET"
echo "Registered Edge host at: $EDGE_TARGET"

chmod +x "$DIR/manticollect_host.sh"
echo "Done."
