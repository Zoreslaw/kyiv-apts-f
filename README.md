# Kiev Apartments Management Bot

## Project Overview
This project is a Telegram bot built using Firebase Cloud Functions to manage cleaning tasks (for now) for Kiev Apartments. The bot helps cleaning staff track apartment check-ins and check-outs, providing them with timely information about their assigned cleaning tasks.

## How It Works
The bot provides the following functionality:

1. **User Registration**: Users register using the `/start` command
2. **Task Management**: Users can view their assigned cleaning tasks with `/get_my_tasks`
3. **Role-Based Access**: Different information is shown to admins vs. cleaning staff
4. **Task Details**: For each assigned apartment, users can see:
   - Check-out details (apartments that need cleaning by 15:00)
   - Check-in details (apartments that need to be ready for new guests)
   - Guest information, apartment addresses, and reservation IDs

The bot integrates with the Kiev Apartments API to fetch real-time information about check-ins and check-outs, and uses Firestore to store user data and cleaning assignments.

## Prerequisites
- Node.js (v22 or later)
- npm (comes with Node.js)
- A Firebase account
- A Telegram bot token (from BotFather)

## What is Firebase?
Firebase is Google's platform for developing mobile and web applications. It provides a suite of tools and services to help developers build, improve, and grow their apps.

## What are Firebase Functions?
Firebase Cloud Functions is a serverless framework that lets you automatically run backend code in response to events triggered by Firebase features and HTTPS requests. Your code runs in a managed environment, so you don't need to provision any infrastructure or worry about scaling.

In this project, we use Firebase Functions to:
- Host a webhook endpoint that receives Telegram updates
- Process commands from users
- Interact with Firestore database
- Make external API calls

## Installation and Setup

### 1. Install Firebase CLI

```bash
npm install -g firebase-tools
```

### 2. Login to Firebase

```bash
firebase login
```

This will open a browser window where you'll need to sign in with your Google account and authorize the Firebase CLI.

### 3. Clone this repository

```bash
git clone https://github.com/faisworld/kyiv-apts-f
```

### 4. Install dependencies

```bash
cd functions

npm install
```


## Deployment
To deploy the functions:

```bash
npm run deploy
```

This will deploy the functions to Firebase and make them available at the URL specified in the output.

## Project Structure
- `functions/index.js` - Main code for the Firebase function handling Telegram webhook
- `functions/package.json` - Node.js dependencies and configuration
- `firebase.json` - Firebase configuration file
- `.firebaserc` - Firebase project linking configuration

## Bot Commands
- `/start` - Register a new user
- `/get_my_tasks` - Get a list of assigned cleaning tasks

## Development
To run the functions for testing:
it is better to create new bot in telegram and test there. 
Also you can deploy the functions to other firebase project and test there.

Also you can use firebase emulators to test the functions locally.

```bash
npm run serve
```

but you will need to update bot webhook url to your local url.

## Troubleshooting
- Check the Firebase Functions logs if you encounter issues:
  ```bash
  firebase functions:log
  ```
- Ensure your Telegram bot token is correct
- Verify that your webhook URL is correctly registered with Telegram

## Security Notes
- The bot token is currently hardcoded in the code with a fallback. For production, you should use Firebase environment configuration.
- Firestore security rules should be set up to protect user data.

## License
This project is proprietary and intended for use by Kiev Apartments only.