# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Strict 2-Step Deletion Workflow**: `gmailCleanup()` now strictly handles email classification and applies the custom `Delete` label to candidate threads without calling Gmail Trash APIs.
- **`trashDeleteLabeledEmails()`**: New separate top-level function that scans `Delete`-labeled threads, executes a 2nd-pass safety validation, and moves approved threads to Trash.
- **Granular DRY_RUN Configuration**: Separated `DRY_RUN` into `CLASSIFICATION` and `TRASH` boolean options in `Config.gs`.

### Changed

- Updated end-of-run execution summary tables and breakdown logs to accurately track `Delete candidates`, `Archived`, `Labeled`, `Safety blocked`, and `No action taken` metrics.
- Formatted `AppLogger.table` with dynamic column padding for clean log output alignment in Apps Script editor.

### Fixed

- Enforced `MAX_THREADS_TO_PROCESS` configuration limit in `trashDeleteLabeledEmails()` so that batch trashing strictly respects the user-defined limit.
- Corrected "No Action" calculation in `gmailCleanup()` and "Eligible for Trash" calculation in `trashDeleteLabeledEmails()` for real (non-dry-run) executions.

## [1.2.0] - 2024-07-31

### Added

-   **Resumable Executions**: `gmailCleanup` now saves state to handle execution time limits, enabling processing of very large inboxes.
-   **Health Check**: Added a `runHealthCheck` function to validate configuration and environment setup.
-   **Execution History & Dashboard**: The script now records execution history, viewable via a new web app dashboard.
-   **Advanced Reporting**: Implemented automated weekly/monthly summary reports and critical error email notifications.
-   **Attachment Cleanup**: New `cleanupAttachments` function to find and label emails with large attachments.
-   **Empty Label Cleanup**: Automated housekeeping to remove unused, script-managed labels after a run.

### Changed

-   **Processing Order**: Threads within a batch are now sorted to process the oldest emails first.
-   **Important Handling**: Emails marked as "Important" by Gmail are now explicitly labeled "Priority" for better visibility.
-   **Final Summary**: The end-of-run summary is more detailed, with "WHY" explanations for key metrics.

## [1.1.1] - 2024-07-31

### Changed

-   Enhanced debug logging to include detailed information about which specific rules, domains, keywords, and senders were matched for each processed thread.

## [1.1.0] - 2024-07-30

### Added

-   **Conditional Debug Logging**: Implemented extensive, verbose logging throughout the application to aid in troubleshooting. This can be enabled via the `CONFIG.EXECUTION.DEBUG` flag.

### Fixed

-   **Trash Rule Logic**: Corrected a critical bug in `CleanupService` where `TRASH_RULES` with `days: 0` were being ignored, preventing immediate deletion of matching threads.

### Changed

-   Improved code quality by making debug logging conditional and ensuring all code comments are consistent.

## [1.0.0] - 2024-07-29

### Added

-   Initial release of the Gmail Smart Cleaner.
-   Core features: email classification, cleanup, archiving, and reporting.
-   Support for local development with `clasp`.
-   CI/CD pipeline using GitHub Actions for automatic deployment.