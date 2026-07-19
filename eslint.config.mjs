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
