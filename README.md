# Health Connect Sync via Home Assistant

> [!CAUTION]
> This plugin is very specific to its authors; but *may* be helpful for other people. Batteries not included.

This plugin syncs health statistics to Obsidian _via Home Assistant_, and using a very particular helper
_in lieu of the standard Home Assistant Companion App_.

## Requirements

- An Android phone with Health Connect enabled. This works with most providers (Google Health, FitBit, Samsung Health, etc. etc.).
- A Home Assistant instance reachable from the Obsidian where you want to run this plugin.
- [This connector Android app](https://github.com/AyraHikari/HealthConnect_to_HomeAssistant) on a device with your Health Connect setup.
- A "long-lived" Home Assistant access token (can be generated from the Security page of your profile).

## Why Home Assistant?

Honestly? I already had it around, the connector app already existed, and it already had a simple REST API one can use to query the output of the connnector app.

## Setup

We're assuming you're fairly familiar with the technologies involved, since this is a very "batteries not included" app.

1. Install this plugin and the connector android app.
2. Generate a Home Assistant user token, if you still need one. These are found under Security in your user profile menu (i.e. not in the admin settings menu anywhere).
3. In the settings for both the plugin and the android app, enter the **Home Assistant URL**, the **Token**, and the **sensor name** you're using. The sensor name doesn't matter; it just needs to match between the app and the plugin.
