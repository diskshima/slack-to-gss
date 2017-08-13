# slack-to-gss

Share pinned messages in Slack to Google Spreadsheet.

## Installation

### Install nvm (optional but recommended)

1. Install [nvm](https://github.com/creationix/nvm#install-script).
1. Install the nvm version in `.nvmrc`.
    ```bash
    nvm install v8.2.1
    ```

## Building The Code

1. Install [yarn](https://yarnpkg.com/).
    ```bash
    npm install -g yarn
    ```
1. Run `yarn install`.
    ```bash
    yarn install
    ```
1. Run the below to transpile the code.
    ```bash
    yarn run build
    ```
1. Copy the code inside `dist/app.js` and paste it into Google App Script.
1. Set the necessary script properties.
    - slack_api_token: Slack API Token
    - sheet_file_id: Google Spreadsheet file ID (the XXX in https://docs.google.com/spreadsheets/d/XXXXXXXXXXXXXXXXXXXX)
    - slack_channel_id: Slack Channel ID (the XXX in https://your_slack_team.slack.com/messages/XXXXXXXXX/)
1. Run the `run` method and/or set triggers as necessary.

## Built with

- [babel](https://babeljs.io/)
- [Flow](https://flow.org/)
