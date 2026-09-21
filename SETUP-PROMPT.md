# The setup prompt

Paste this into a fresh pod's chat. Everything it needs to know is in the repo.

```
Set this pod up from https://github.com/deepak-jha-kgp/gilfoyle — import it into
this pod, then read its AGENTS.md and README and do what they say.

Stop and ask me for whatever needs a human: connecting GitHub is an OAuth round
trip, and two import variables do not exist until it is connected.

Never invent signals — fill the queue with seed/ingest.sh or leave it empty. Leave
the automations paused; dispatch-fixer opens pull requests unattended.

Then tell me what exists, what is connected, what is still paused, and what you
could not verify.
```

## One precondition

A pod's assistant ships with **no toolsets and no grants** — it cannot run a shell
or read a table, so it cannot act on this as delivered. Give it a shell first (add
`WORKSPACE_CLI` to its toolsets), or follow [README.md](README.md#setting-it-up)
yourself; the steps are the same either way.
