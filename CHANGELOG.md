# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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