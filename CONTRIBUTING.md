# Contributing to Gmail Smart Cleaner

First off, thank you for considering contributing! It's people like you that make open source such a great community.

## Where do I go from here?

If you've noticed a bug or have a feature request, [make one](https://github.com/kaunain/gmail-smart-cleaner/issues/new)! It's generally best if you get confirmation of your bug or approval for your feature request this way before starting to code.

## Fork & create a branch

If this is something you think you can fix, then [fork the repository](https://github.com/kaunain/gmail-smart-cleaner/fork) and create a branch with a descriptive name.

A good branch name would be (where issue #123 is the ticket you're working on):

```sh
git checkout -b 123-fix-bug-in-summary-report
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