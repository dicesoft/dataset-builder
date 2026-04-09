#!/usr/bin/env bash
# HuggingFace Loading Validator
# Builds the project, generates a DatasetDict dataset, and verifies it loads with HF datasets.
# Gracefully skips if Python or the datasets library is not installed.
# Run via: bash scripts/validate-hf-loading.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE="$PROJECT_DIR/src/formatters/__fixtures__/huggingface-data.json"
OUTPUT_DIR=$(mktemp -d)

echo ""
echo "HuggingFace Loading Validator"
echo "============================="

# Check Python
if ! command -v python3 &>/dev/null && ! command -v python &>/dev/null; then
  echo "SKIP: Python not found. Install Python 3 to run this validator."
  exit 0
fi

PYTHON_CMD="python3"
if ! command -v python3 &>/dev/null; then
  PYTHON_CMD="python"
fi

# Check datasets library
if ! $PYTHON_CMD -c "import datasets" 2>/dev/null; then
  echo "SKIP: HuggingFace 'datasets' library not installed."
  echo "      Install with: pip install datasets"
  exit 0
fi

echo "Using Python: $($PYTHON_CMD --version 2>&1)"
echo "Output dir: $OUTPUT_DIR"

# Build the project
echo ""
echo "Building project..."
cd "$PROJECT_DIR"
npm run build --silent 2>/dev/null || {
  echo "FAIL: Build failed"
  rm -rf "$OUTPUT_DIR"
  exit 1
}

# Generate DatasetDict output
echo "Generating DatasetDict dataset..."
node dist/cli/index.js format \
  -i "$FIXTURE" \
  -f datasetdict \
  -o "$OUTPUT_DIR" \
  --split 80:10:10 \
  2>/dev/null || {
  echo "FAIL: CLI format command failed"
  rm -rf "$OUTPUT_DIR"
  exit 1
}

# Verify with Python
echo "Loading dataset with HuggingFace datasets..."
RESULT=$($PYTHON_CMD -c "
from datasets import load_dataset
import json, os, sys

try:
    ds = load_dataset('$OUTPUT_DIR')
    if 'train' not in ds:
        print('FAIL: No train split found')
        sys.exit(1)
    num_rows = len(ds['train'])
    if num_rows == 0:
        print('FAIL: Train split has 0 rows')
        sys.exit(1)
    splits = list(ds.keys())
    print(f'PASS: Loaded dataset with splits: {splits}, train rows: {num_rows}')
except Exception as e:
    print(f'FAIL: {e}')
    sys.exit(1)
" 2>&1) || {
  echo "$RESULT"
  rm -rf "$OUTPUT_DIR"
  exit 1
}

echo "$RESULT"

# Cleanup
rm -rf "$OUTPUT_DIR"

echo ""
echo "Done."
