This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start the backend and Metro

Install dependencies in the repository root and in `backend`. Set up `backend/.env` using `backend/.env.example` as a template. `MONGODB_URI` must point to an authorized development replica set or sharded cluster. Set `JWT_SECRET` to the development signing secret. `MONGODB_DB` selects the database and defaults to `school_management`. `PORT` defaults to `5000`. The backend loads `backend/.env` when launched through the commands below. Values already in the process environment take precedence.

In the same terminal that starts Metro, set `SCHOOL_APP_DEV_API_ORIGIN` to the backend origin, with no `/api` suffix. The standard Android emulator reaches the host at `10.0.2.2`. From the repository root in PowerShell, run the following for the default backend port.

```powershell
$env:SCHOOL_APP_DEV_API_ORIGIN = 'http://10.0.2.2:5000'
npm run dev
```

In Windows Command Prompt, use `set "SCHOOL_APP_DEV_API_ORIGIN=http://10.0.2.2:5000"` before `npm run dev`. For a physical Android device, use the development PC's reachable LAN address and the configured backend port. The device and PC must be on a network that permits the connection. Restart Metro after changing the origin. Release builds use their separately configured public HTTPS origin.

The root command runs the backend and Metro together. The backend prints the following when it is ready.

```text
MongoDB connected successfully
Required database indexes initialized
Backend server listening on port 5000
```

Use `Ctrl+C` to stop the development processes. `npm start` still runs Metro by itself with its interactive keyboard shortcuts. From the root, `npm --prefix backend run dev` runs the backend by itself and `npm --prefix backend run dev:watch` enables backend restart on source edits.

If login cannot reach the API, first check `Invoke-RestMethod http://127.0.0.1:5000/` on the development PC. A `200` confirms the HTTP listener. Then check the origin used by Metro and whether the device can reach that address. If startup reports `EADDRINUSE`, inspect the owner with `Get-NetTCPConnection -LocalPort 5000 -State Listen` and close the known owner through its own terminal or application. MongoDB startup errors require checking the configured deployment, network access and database permissions.

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
