# Gmail Smart Cleaner

<p align="center">
  <a href="https://script.google.com">
    <img src="https://img.shields.io/badge/Built%20with-Google%20Apps%20Script-4285F4.svg" alt="Built with Google Apps Script">
  </a>
  <a href="https://github.com/kaunain/gmail-smart-cleaner/actions/workflows/deploy.yml">
    <img src="https://github.com/kaunain/gmail-smart-cleaner/actions/workflows/deploy.yml/badge.svg" alt="Deploy to Apps Script">
  </a>
  <a href="https://github.com/kaunain/gmail-smart-cleaner/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/kaunain/gmail-smart-cleaner" alt="License">
  </a>
</p>

A production-ready Google Apps Script to automatically organize, label, and clean your Gmail inbox. This project is designed for developers, providing a robust, scalable, and fully automated solution that you can set up once and forget.

---

## ✨ Features

- **🤖 Smart Organization**: Automatically classifies and labels emails using a powerful rule engine.
- **🗑️ Automated Cleanup**: Intelligently trashes ephemeral emails like OTPs and old promotions.
- **🗄️ Intelligent Archiving**: Keeps your inbox clean by archiving read newsletters and notifications.
- **🛡️ Safety First**: Protects important, starred, or unread emails with non-negotiable safety checks.
- **💪 Resilient by Design**: Handles massive inboxes by gracefully managing Google's execution time limits.
- **📊 Health & Reporting**: Includes an Execution Dashboard, automated email reports, and error notifications.
- **📎 Attachment Management**: Finds and labels emails with large attachments for manual review.
- **⚙️ Developer Focused**: CI/CD-ready, built for VS Code, and fully configurable.

---

## 🏗️ Project Structure

All application code resides in the `/src` directory.

```
.
├── .github/workflows/deploy.yml  # GitHub Actions CI/CD workflow
├── src/                          # Google Apps Script source code
│   ├── Config.gs                 # All user settings and rules
│   ├── Main.gs                   # Main entry points for the script
│   ├── ... (other modules)
│   └── appsscript.json           # Apps Script manifest
├── .clasp.json                   # Clasp project configuration (local)
├── .gitignore
├── package.json                  # NPM scripts and dependencies
└── README.md
```

---

## 🚀 Installation & Deployment

This guide provides a professional setup using `clasp`, a command-line tool for managing Apps Script projects. This allows you to use your favorite code editor (like VS Code) and version control (Git).

### Prerequisites

1.  **Node.js**: Version 22 LTS or higher. If you use [nvm](https://github.com/nvm-sh/nvm), you can run `nvm use` in the project directory to automatically switch to the correct version.
2.  **Google Account**: The Gmail account you want to clean.

### Step 1: Local Setup

1.  **Clone the Repository**:

    ```sh
    git clone https://github.com/kaunain/gmail-smart-cleaner.git
    cd gmail-smart-cleaner
    ```

2.  **Install Dependencies**:

    ```sh
    npm install
    ```

3.  **Log in to Google**: Authorize `clasp` to manage your Google Apps Script projects. This will open a browser window.

    ```sh
    npm run login
    ```

4.  **Create a New Apps Script Project**: This command creates a new, standalone Apps Script project in your Google Drive and links it to this local repository.

    ```sh
    npm run create
    ```

    This will generate a `.clasp.json` file containing your new `scriptId`.

5.  **Push the Code**: Deploy the code from your local machine to the newly created Apps Script project.

    ```sh
    npm run push
    ```

6.  **Open the Project**: Open the project in the Google Apps Script web editor.
    ```sh
    npm run open
    ```

### Step 2: First Run & Configuration

1.  **Enable Advanced Services**: In the Apps Script editor, you need to enable the Gmail API for the script's core features to work.
    - On the left sidebar, click the **+** icon next to **Services**.
    - Select **Gmail API** from the list and click **Add**.

2.  **Initial Run**: In the Apps Script editor, select the `runInitialSetup` function from the dropdown menu and click **Run**.
    - You will be prompted to grant the necessary permissions (Gmail, etc.). Please review and accept them.
    - This function will create all the necessary Gmail labels defined in `src/Config.gs`.

3.  **Configure the Script**:
    - Open `src/Config.gs` in your local code editor.
    - Set `DRY_RUN: false` to allow the script to make changes.
    - Customize `SAFE_SENDERS`, `SAFE_DOMAINS`, and other rules to fit your needs.
    - Save the file and push the changes: `npm run push`.

4.  **Install Triggers**: To automate the script, run the `installTriggers` function from the Apps Script editor. This will set up the daily cleanup and summary report triggers.

Your Gmail Smart Cleaner is now fully configured and automated!

### Step 3: Deploy as a Web App (for Dashboard)

1.  In the Apps Script editor, click **Deploy** > **New deployment**.
2.  Click the "Select type" gear icon and choose **Web app**.
3.  In the configuration:
    - Give it a description (e.g., "v1.0 Dashboard").
    - Execute as: **Me**.
    - Who has access: **Only myself**.
4.  Click **Deploy**. You will be given a URL for your web app dashboard.

---

## 🤖 CI/CD with GitHub Actions (Optional)

Set up a CI/CD pipeline to automatically deploy changes to Apps Script whenever you push to your `main` branch on GitHub.

### Step 1: Create a GitHub Repository

Fork this repository or push your local clone to a new repository on your GitHub account.

### Step 2: Get Credentials

After running `npm run login` locally, a file named `.clasprc.json` is created in your home directory (`~/.clasprc.json`). Open this file. It contains the credentials needed for the GitHub Action.

### Step 3: Add GitHub Secrets

In your GitHub repository, go to `Settings` > `Secrets and variables` > `Actions` and add the following repository secrets:

- `CLASP_SCRIPT_ID`: The script ID from your local `.clasp.json` file.
- `CLASPRC_JSON`: The entire JSON content of your `~/.clasprc.json` file. You can get this by running `cat ~/.clasprc.json` in your terminal and copying the full output.

### Step 4: Deploy!

Now, every time you `git push` to your `main` branch, the GitHub Action will automatically run and deploy the latest version of your code to your Google Apps Script project.

---

## ⚙️ Configuration

All settings are centralized in `src/Config.gs`.

- `DRY_RUN`: Set to `true` to test rules without making any changes.
- `BATCH_SIZE`: Number of emails to process at once.
- `TRASH_RULES`: Define which labels lead to deletion and after how many days.
- `CLASSIFICATION_RULES`: The core logic for labeling emails based on sender, subject, and more.
- `SAFE_SENDERS` / `SAFE_DOMAINS`: Whitelist important senders and domains to protect them from deletion.

---

## 🏷️ GitHub Topics

To improve the discoverability of this repository, we recommend adding the following topics on the main repository page:
`gmail` `google-apps-script` `automation` `productivity` `gmail-api` `g-suite` `google-workspace` `clasp`

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the issues page. Please read our contributing guide for more details.

---

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

_Disclaimer: This is not an official Google product._
