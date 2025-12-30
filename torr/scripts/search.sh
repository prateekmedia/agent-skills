#!/bin/bash

# Usage: ./search.sh <source> "<query>" [page]
# Example: ./search.sh piratebay "ubuntu iso" 1
# List sources: ./search.sh --list-sources
# API endpoint: ARC_API_URL=http://localhost:3000 ./search.sh ...

# Configurable API endpoint (default: http://localhost:3000)
API_URL="${ARC_API_URL:-http://localhost:3000}"

# Valid sources list
VALID_SOURCES="piratebay 1337x tgx yts nyaasi all"

# Dependency checking
check_dependencies() {
  local missing_deps=()

  command -v curl >/dev/null 2>&1 || missing_deps+=("curl")
  command -v jq >/dev/null 2>&1 || missing_deps+=("jq")

  if [ ${#missing_deps[@]} -gt 0 ]; then
    echo "Error: Missing required dependencies: ${missing_deps[*]}"
    echo "Install with: brew install ${missing_deps[*]} (macOS) or apt-get install ${missing_deps[*]} (Linux)"
    exit 1
  fi
}

# Function to list available sources
list_sources() {
  cat <<EOF
Available Sources:

Source      Type
piratebay   General
1337x       General
tgx         General
yts         Movies
nyaasi      Anime
all         All (slow)
EOF
  exit 0
}

# Check for --list-sources flag
if [ "$1" = "--list-sources" ] || [ "$1" = "-l" ]; then
  list_sources
fi

# Check dependencies first
check_dependencies

if [ $# -lt 2 ]; then
  echo "Usage: $0 <source> \"<query>\" [page]"
  echo "       $0 --list-sources"
  echo ""
  echo "Sources: piratebay, 1337x, yts, nyaasi, tgx, all"
  exit 1
fi

SOURCE="$1"
QUERY="$2"
PAGE="${3:-1}"

# Validate source
if [[ ! " $VALID_SOURCES " =~ " $SOURCE " ]]; then
  echo "Error: Invalid source '$SOURCE'"
  echo ""
  echo "Available sources:"
  list_sources
fi

# URL encode the query properly using jq
ENCODED_QUERY=$(jq -rn --arg q "$QUERY" '$q|@uri')

RESPONSE=$(curl -s "$API_URL/api/$SOURCE/$ENCODED_QUERY/$PAGE")

# Check if API response is valid JSON
if ! echo "$RESPONSE" | jq . >/dev/null 2>&1; then
  echo "Error: API returned invalid response. Make sure ArcTorrent is running at $API_URL"
  echo "Start it with: cd /tmp/ArcTorrent && npm start &"
  exit 1
fi

# Check if empty array
if [ "$(echo "$RESPONSE" | jq 'length')" -eq 0 ]; then
  echo "No results found for: $QUERY"
  exit 1
fi

# Output results
echo "$RESPONSE" | jq -r '.[] | "\(.Name)\t\(.Size)\tSeeders: \(.Seeders)\t\(.Magnet)"'
