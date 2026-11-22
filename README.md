# Claude usage meter

A small Claude Code mod that keeps your Claude usage limits on screen, in one line above the prompt:

**5h ● 42% resets in 2h 14m    Week ● 61% resets in 3d 4h**

- Your current 5-hour session usage and weekly usage, each with when it resets
- Color-coded: green under 50%, yellow 50–80%, red over 80%
- Refreshes on its own every 3 minutes
- A pop-up warning when either limit passes 80% (once per limit period)

It shows the usage of whoever is signed in to Claude Code, and works in the terminal, the Claude desktop app and the VS Code extension. It needs a Claude subscription login (not an API key).

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install usage-meter --marketplace EsraaIsmaiel1/claude-usage-meter
```

Answer `y` to add the marketplace, then pick a scope (user scope makes it load in every session).

Or from a shell:

```
claude plugin install usage-meter --marketplace EsraaIsmaiel1/claude-usage-meter
```

In the Claude desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `EsraaIsmaiel1/claude-usage-meter`, then **Add plugin**.

## How it gets the numbers

Every 3 minutes it asks Anthropic for the same figures Claude Code's `/usage` shows, using Claude Code's own login (the mod never sees your token). That address is not a documented API, so if it ever stops working the meter falls back to the figures that come with each Claude reply and shows "(updates after replies)".

To change the refresh interval or the warning level, edit `REFRESH_MS` or `WARN_AT` at the top of `hooks/register.tsx`.
