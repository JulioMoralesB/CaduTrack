# Working in this repository

## Never use a real credential as a test fixture

On 2026-08-30 the Telegram bot token was committed to this public repository in
`backend/tests/test_config.py`, inside the regression test for #64 — the test
whose entire purpose is proving that the token never reaches the logs. It was
named `fake_token`. Someone found it and used the bot; the token was revoked on
2026-09-01.

Two things made it survive review:

- **The name asserted the opposite of the truth.** `fake_token`, `dummy_`,
  `test_`, `example_` are claims, not evidence. A reader who trusts the name
  never looks at the value — and so does a human skimming a diff.
- **The value was realistic on purpose.** Reaching for the real one is the
  path of least resistance when a fixture needs to look real, and the real one
  is sitting in `.env` next to you.

So, when a test needs something credential-shaped:

- **Construct it, do not paste it.** `"1234567890:" + "A" * 35` carries the
  shape, cannot be a real value, and cannot be quietly replaced with one
  without the diff making that obvious.
- **Never read a value out of `.env`, the environment, a password manager, a
  running container, or the deployed config to put in a test** — not even
  temporarily while iterating.
- Assume every value in this repository is public the moment it is committed.
  This repository *is* public.

The same rule covers fixtures in issues, PR descriptions, and pasted logs.
