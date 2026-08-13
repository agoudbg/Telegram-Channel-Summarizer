# Telegram Channel Summarizer

An instruction-only Codex skill that turns Telegram channel posts into concise, sourced digests. It has no bot runtime, application dependencies, API keys, database, or background service.

## Install

This repository intentionally stores the skill under `skills/`, not Codex's repository auto-discovery path (`.agents/skills/`). Install it with the built-in skill installer:

```text
Use $skill-installer to install https://github.com/agoudbg/Telegram-Channel-Summarizer/tree/main/skills/telegram-channel-summarizer
```

Restart Codex if the newly installed skill does not appear. You can also copy `skills/telegram-channel-summarizer` to `$CODEX_HOME/skills/telegram-channel-summarizer` (normally `~/.codex/skills/telegram-channel-summarizer`).

## Use

Paste channel posts directly:

```text
Use $telegram-channel-summarizer to summarize the Telegram channel posts below.
```

Summarize a scoped range from a public channel:

```text
Use $telegram-channel-summarizer to summarize the latest 30 posts from https://t.me/telegram.
```

Summarize a Telegram Desktop export:

```text
Use $telegram-channel-summarizer to summarize the attached result.json and focus on product announcements.
```

The skill treats pasted text as the primary, most reliable input. Public `t.me` pages and Telegram Desktop JSON or HTML exports are best-effort alternatives.

## Output

The default output preserves the compact format of the original bot: one topic title followed by several distilled titles that link directly to the source posts.

```markdown
## Aurora 2.0 arrives with a short outage

- [Friday release includes a five-minute API interruption](https://t.me/example/101)
- [Internal benchmark claims 31% lower median latency](https://t.me/example/103)
```

It does not add a channel heading, overview paragraph, coverage section, or separate source labels unless the user requests a different format.

## Limits

- Text and media captions only; image, audio, and video contents are not analyzed.
- Public `t.me` pages only; the skill never bypasses login, invite links, private channels, or access controls.
- A channel URL requires a date range or post count. The skill asks for one before browsing when it is missing.
- Web pages may expose only part of the requested history. Every digest reports the content actually covered.
- No Telegram API credentials, bot token, OpenAI API key, or local service is required.

## Legacy bot

The original 2024 Telegram Bot implementation is preserved in the [`legacy`](https://github.com/agoudbg/Telegram-Channel-Summarizer/tree/legacy) branch. It is archived and receives no maintenance or dependency updates.

## License

GPL-3.0. See [LICENSE](LICENSE).
