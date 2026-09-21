# The setup prompt

Paste this into a fresh pod's chat. Everything it needs to know is in the repo.

```
Set this pod up from https://github.com/deepak-jha-kgp/gilfoyle: clone it and run
./setup.sh — nothing else, and nothing invented. It ends with a note addressed to
you; follow it, and keep the checkout, you will need it again.
```

`setup.sh` says almost nothing while it works — sixteen lines of `created` is a
build log, and pasting one at somebody is not an introduction. It ends instead with
a note **addressed to the agent**: a draft of what to tell the person, in prose,
and a short table of what to run itself when they answer.

That is the part worth getting right. Whoever is reading is on a phone, and they
asked for a thing, not for a terminal — so every next step is phrased as something
they **say**, never as a command they run. "Fill it from a repo you already have"
rather than `./seed/ingest.sh <owner/repo> 4`; "start watching by itself" rather
than `lemma schedules resume`. The agent runs those; that is what it is for. The
script even checks whether the `gh` CLI is signed in, and leaves the seeding offer
out entirely when it is not, because offering somebody a step that will fail is
worse than not offering it.

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

Clone to finished, measured on a fresh pod: **15 seconds**.

Telling an agent what *not* to do is worth more here than telling it what to do.
The work itself was never the slow part.
