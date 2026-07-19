#!/bin/bash
#
# This script automates code quality checks and fixes.
# It formats all code, fixes auto-fixable linting issues,
# and reports any outdated dependencies.

set -e # Exit immediately if a command exits with a non-zero status.

echo "🎨 Formatting code with Prettier..."
npm run format

echo "✅ Fixing linting issues with ESLint..."
npm run lint:fix

echo "🔍 Checking for outdated dependencies..."
# We use '|| true' because 'npm outdated' exits with a non-zero code
# if outdated packages are found, which would otherwise stop the script.
npm outdated || true

echo "✨ All checks and fixes complete!"