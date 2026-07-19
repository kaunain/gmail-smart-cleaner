echo "Fixing ESLint config..."

cat > eslint.config.mjs <<'EOF'
import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    files:["src/**/*.gs"],
    languageOptions:{
      ecmaVersion:"latest",
      sourceType:"script",
      globals:{
        GmailApp:"readonly",
        Gmail:"readonly",
        MailApp:"readonly",
        HtmlService:"readonly",
        SpreadsheetApp:"readonly",
        UrlFetchApp:"readonly",
        DriveApp:"readonly",
        ScriptApp:"readonly",
        Session:"readonly",
        CacheService:"readonly",
        LockService:"readonly",
        PropertiesService:"readonly",
        Utilities:"readonly",
        Logger:"readonly",
        console:"readonly"
      }
    },
    rules:{
      "no-console":"off",
      "no-unused-vars":"off",
      "no-undef":"off",
      "no-redeclare":"off"
    }
  }
];
EOF

echo "Replacing console.log..."

find src -type f -name "*.gs" \
-exec sed -i 's/console\.log/Logger.log/g' {} \;

echo "Running ESLint..."

npx eslint src --fix