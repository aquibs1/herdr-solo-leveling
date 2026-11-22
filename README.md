# Herdr – Solo Leveling theme

A Solo Leveling "System" theme for [Herdr](https://herdr.dev): dark-blue/gold colour theme, a custom layout,
and the `sl-system` / `sl-pane` / `sl-toast` mods (Daily Quest, shadow army, system notifications).

## Install
```sh
git clone <this repo> && cd herdr-solo-leveling
./install.sh
```
Restart Herdr, press `cmd-shift-l` and choose **solo-leveling**.
Optional key binding (in `~/.config/herdr-app/keys.json`):
```json
"layout:solo-leveling": { "cmd-shift-s": "sl-system.home" }
```

## Notes
- The layout also uses Herdr's stock mods (agents, changes, files, spaces, workspace-chrome, workspace-status); these ship with Herdr.
- `tabs-timer` is a small clone of the stock `tabs` mod with a timer.
- The Quest Master (`quest-master.sh`) uses the `gh` and `claude` CLIs and a Jira (Atlassian) connector in Claude;
  without them the quests fall back to what is available. Edit the scripts to suit your own setup.
