# The setup prompt

Paste this into a fresh pod's chat. Everything it needs to know is in the repo.

```
Set this pod up from https://github.com/deepak-jha-kgp/gilfoyle — clone it and run
./setup.sh (LEMMA_POD_ID is already in your shell). That is the whole job.

Nothing else: no dry run, no npm, no browser, no widget. The app ships prebuilt,
and its sign-in gate belongs to a human, not to you — the `lemma pods describe`
that setup.sh already printed is what verified means here.

Answer in plain text with the GitHub authorize link it gives you, and a line each
for what landed, what is paused, and what is not connected. Never invent signals.
```

The pod's own assistant can carry this out as delivered: it runs with a fixed,
batteries-included toolset — a shell, a browser, the pod tools, sub-agents — and
with **your** permissions rather than grants of its own. There is nothing to
configure before pasting.

## Why it is written that way

The first version of this prompt said "read its AGENTS.md and README and do what
they say", and setting a pod up took **over ten minutes**. Almost none of that was
the pod. Three things ate it, and each line above closes one:

- **The app was a Vite project**, so every import ran `npm ci` and `npm run build`
  — a minute each time — and then *failed*, because a Vite build demands three
  `VITE_LEMMA_*` variables a fresh pod has never heard of. The import aborted
  part-way through, which meant the schedules and the agents' grants never landed,
  which meant importing again. The app now ships built, and the whole import is
  one pass of about twelve seconds.
- **The assistant tried to look at the app in a browser.** It cannot: every visitor
  meets a Lemma sign-in, and an agent has no session to get past it. That was three
  minutes of a dead end, twice, and it ended in "could not verify" both times.
- **It built a status widget to report with.** Loading the widget skill, reading a
  starter, writing the HTML and displaying it is another ninety seconds for
  something four sentences say better.

Clone to GitHub link, measured on a fresh pod: **16.5 seconds**.

Telling an agent what *not* to do is worth more here than telling it what to do.
The work itself was never the slow part.
