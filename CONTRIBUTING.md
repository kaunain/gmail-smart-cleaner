# Contributing to Gmail Smart Cleaner

First off, thank you for considering contributing to Gmail Smart Cleaner! It's people like you that make open-source such a great community. We welcome any type of contribution, not only code.

## Code of Conduct

This project and everyone participating in it is governed by the Code of Conduct. By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating a bug report, please check our issues list as you might find that you don't need to create one. When you are creating a bug report, please include as many details as possible by filling out the bug report template.

### Suggesting Enhancements

If you have an idea for a new feature or an improvement to an existing one, we would love to hear about it. Please fill out our feature request template with as much detail as possible.

### Your First Code Contribution

Unsure where to begin contributing? You can start by looking through `good-first-issue` and `help-wanted` issues:

-   Good first issues - issues which should only require a few lines of code, and a test or two.
-   Help wanted issues - issues which should be a bit more involved than `good-first-issue` issues.

### Pull Requests

When you're ready to contribute code, please follow these steps:

1.  **Fork the repository** and create your branch from `main`.
2.  **Set up your development environment** by running `npm install`.
3.  **Make your changes**. Ensure your code adheres to the project's style by running `npm run lint` and `npm run format`.
4.  **Write tests** if you're adding a new feature or fixing a bug.
5.  **Ensure all tests pass** by running `npm test` (if applicable).
6.  **Create a pull request**. Use the pull request template to describe your changes. Make sure your PR is linked to any relevant issues.

## Development Process

### Branching

Our branching model is simple:

-   `main`: This is the primary branch where the source code of `HEAD` reflects the latest delivered development changes for the next release.
-   **Feature branches**: All new development should be done in a feature branch, created from `main`. A good branch name would be `feat/add-new-rule` or `fix/cleanup-service-bug`.

```sh
git checkout -b feat/my-new-feature
```

## Get the test suite running

Make sure you're running Node.js v22 or higher.

```sh
npm install
```

## Implement your fix or feature

At this point, you're ready to make your changes! Feel free to ask for help; everyone is a beginner at first.

## Make a Pull Request

At this point, you should switch back to your `main` branch and make sure it's up to date with the `main` branch of the original repository:

```sh
git remote add upstream git@github.com:kaunain/gmail-smart-cleaner.git
git checkout main
git pull upstream main
```

Then update your feature branch from your local copy of `main`, and push it!

```sh
git checkout 123-fix-bug-in-summary-report
git rebase main
git push --set-upstream origin 123-fix-bug-in-summary-report
```

Finally, go to GitHub and make a Pull Request.

---

*This Contributing guide was adapted from the Puppeteer Contributing Guide.*