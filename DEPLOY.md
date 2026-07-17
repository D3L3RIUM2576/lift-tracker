# Install Lift Tracker on iPhone for free

## Recommended: GitHub Pages

1. Sign in to GitHub and create a new **public** repository named `lift-tracker`.
2. Upload every file and folder from this `lift-tracker` folder into the repository root.
3. Open the repository's **Settings**.
4. Select **Pages** under **Code and automation**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Select the `main` branch and `/ (root)`, then save.
7. Wait for GitHub to provide a URL resembling:
   `https://YOUR-USERNAME.github.io/lift-tracker/`
8. Open that URL in Safari on the iPhone.
9. Tap **Share**, then **Add to Home Screen**.
10. Turn on **Open as Web App**, then tap **Add**.

After the app has loaded successfully once, its interface files are cached for
offline use. Workout information remains in Safari storage on that device.

## Temporary local test from a Mac

In Terminal, change into this folder and run:

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

Keep the Mac and iPhone on the same Wi-Fi network. Find the Mac's local IP
address in **System Settings > Wi-Fi > Details**, then open this in iPhone
Safari:

```text
http://MAC-IP-ADDRESS:8000
```

This local option stops working when the Mac server closes and does not provide
the reliable HTTPS/offline installation of GitHub Pages.
