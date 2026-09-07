# Working in this repository

## Never use a real credential as a test fixture

On 2026-08-30 the Telegram bot token was committed to this public repo in
`backend/tests/test_config.py` — the regression test for #64, whose entire
purpose was proving the token never reaches the logs. Someone found it and
used the bot; the token was revoked 2026-09-01.

Two things let it survive review:

- **The name asserted the opposite of the truth.** It was called
  `fake_token`. `fake_`, `dummy_`, `test_`, `example_` are claims, not
  evidence — a reader who trusts the name never checks the value.
- **The value was realistic on purpose**, because the real one was sitting
  in `.env` right there — the path of least resistance.

So when a test needs something credential-shaped:

- **Construct it, don't paste it.** `"1234567890:" + "A" * 35` carries the
  shape, can't be a real value, and can't be swapped for one without the
  diff showing it.
- **Never copy a value out of `.env`, the environment, a password manager,
  a running container, or deployed config into a test** — not even
  temporarily.
- Assume every value committed here is public — this repo *is* public.

Same rule for fixtures in issues, PR descriptions, and pasted logs.
