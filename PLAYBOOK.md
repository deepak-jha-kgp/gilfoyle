# Making a pod set itself up in under a minute

This pod used to take **over ten minutes** to import into a fresh pod, and ended
with a wall of terminal output pasted at whoever asked for it. It now takes
**sixteen seconds** and ends with a sentence. Almost nothing about that was
specific to triage, so here is the general version — for the next pod, and the one
after that.

The order below is the order of the wins. Do the first one and you have most of it.

---

## 1. Ship the app built

**This is the whole thing.** A Lemma app's deploy path is chosen by what sits in
`apps/<name>/source/`:

| What is there | What the CLI does |
|---|---|
| `package.json` | `npm ci`, `npm run build`, and **three required `VITE_LEMMA_*` env vars** |
| `index.html`, no `package.json` | uploads it as-is. No build, no env |

A fresh pod has none of those three variables, so a Vite-shaped bundle spends a
minute building and then **fails at the app step — which is last**. Everything
after it is abandoned: schedules never created, agents left with zero grants. The
person importing sees "app build failed", fixes the env, and imports again; the
second import is another minute. That is where the ten minutes went, and none of
it was the pod.

So: move the Vite project out of `apps/`, commit its `dist/` as
`apps/<name>/source/`, and add a build script that regenerates one from the other.

```bash
# app/build.sh
env -u VITE_LEMMA_API_URL -u VITE_LEMMA_AUTH_URL -u VITE_LEMMA_POD_ID npm run build
rm -rf ../apps/<name>/source && mkdir -p ../apps/<name>/source
cp -R dist/. ../apps/<name>/source/
grep -rqE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' ../apps/<name>/source \
  && { echo "refusing: a uuid is in the build output" >&2; exit 1; }
```

The `env -u` and the `grep` are not fussiness. Vite inlines `import.meta.env.*` at
build time, so a `.env.local` you forgot about bakes **your pod id into a public
repository**. That nearly happened here. Nothing is lost by clearing them: the host
injects `window.__LEMMA_CONFIG__` when it serves the app, which is where `podId`,
`apiUrl` and `authUrl` come from in production anyway.

A `dist.zip` beside `source/` does nothing while `source/` exists. `lemma pods
export` writes both; only `source/` is read.

## 2. One script, and the order inside it

Everything the setup does belongs in `setup.sh`, so it is one tool call instead of
five and there is nothing left to improvise. Four things about the order, each of
which was a bug first:

**Name the pod first, as its own import.** `--set-pod-meta` is the only CLI pod
rename, and it applies metadata *before* any resource — so in an organization that
already has a pod of that name, a `409 POD_CONFLICT` takes the entire import down
before a single table exists. Rename from a directory holding nothing but
`pod.json`: four seconds, and a conflict costs only the name. First, not last,
because **email surfaces take their address from the pod's name at the moment they
are created** — rename afterwards and the pod is `donna` while its inbox still
reads `pod-4f9e@`.

**Name the app's `public_slug` explicitly.** It is unique across every pod on the
server, and the CLI's fallback is the pod id's first *eight* hex characters —
which two pods created in the same instant share. Pass
`--var <name>_slug=<app>-$(printf '%s' "${LEMMA_POD_ID//-/}" | tail -c 12)`; the
id's tail is random where its head is a timestamp.

**Import quietly.** Keep the log, print it only on failure. Sixteen rows of
`created` is a build log, and pasting one at somebody is not an introduction.

**Do not pass variables that do not exist yet.** An account id for a connector
nobody has connected cannot be resolved, and an unresolved account variable is
silently dropped — leaving a webhook schedule that looks right and can never fire.
Import without it, connect afterwards, and wire it in a second script.

## 3. The hero: one sentence, and the thing itself

The hero is the first thing the pod does that the person could not have done in
the time it took to ask. It is not the app and it is not the import. Name it
before you write a line of setup, because everything else is arrangement around
it.

- **A triage pod:** a real queue, out of a repository they already have.
- **A design pod:** the artifact. A logo sheet, a palette, a one-page PDF —
  *arriving in the conversation*, not waiting behind a link.
- **A chief of staff:** this morning's briefing, on the morning they asked.

Three rules, and the second is the one people miss.

**It must be reachable by saying one sentence.** Not by running a command. "Fill
it from a repo you already have", not `./seed/ingest.sh <owner/repo> 4`. The agent
runs the script; that is what an agent is for. If the only way to reach the hero
is a shell command, there is no hero — there is a README.

**It must arrive where the person is.** In a chat that means the file itself:
upload it to the pod and `display_resource(type="FILE", path=...)`. A link to a
dashboard is a second decision you are asking somebody to make before they have
seen anything. Worth knowing about rendering: pod **functions** have no Pillow, no
ffmpeg, and pip is off — but the **`WORKSPACE_CLI` agent sandbox has Chromium and
pip**, so an image or a PDF is produced by an agent (HTML → headless Chromium →
PDF/PNG), uploaded, then displayed. The pod's own assistant has `WORKSPACE_CLI`
already.

**It must be real.** Whatever the hero produces comes from the person's own
material — their repository, their site, their mail. A pod that demos itself with
invented rows demos well and teaches nothing, because every number in it is a
number somebody made up. If there is nothing real to work from yet, show an empty
queue and say so.

## 4. Say it to the person, not at them

Whoever is reading asked for this in a message. They are very likely on a phone,
and they did not ask for a terminal.

So `setup.sh` should end with a note addressed to **the agent**, not to them:

- a draft of what to say, in prose, with the real values already substituted;
- a short table of what the agent runs *itself* when they answer —
  `they authorized -> ./wire-<connector>.sh`, `they named a repo -> ./seed/…`;
- an explicit "say this in your own words; do not paste this frame".

Then every offer in the draft is phrased as something they say. "Start watching by
itself", not `lemma schedules resume`. And check before you offer: if the hero
needs the `gh` CLI signed in, or a connector, test for it and **leave the line out
when it is not there.** Offering somebody a step that will fail is worse than
staying quiet about it.

## 5. What ships switched off

Not "everything paused" — that is cowardice dressed as caution, and it leaves the
pod inert. The line is whether it acts on the world without a person:

- **On:** anything that only reads, or only writes pod rows. A morning briefing. A
  commitment extractor. A table that refreshes itself.
- **Off, until somebody says otherwise:** anything outward-facing. Opening a pull
  request. Sending mail. Posting. Say plainly which one it is and why.

## 6. What to forbid, and why it is worth the words

An agent doing setup will otherwise spend more time on these three than on the
work. Telling it what *not* to do is worth more than telling it what to do:

- **No dry run** on an unmodified checkout. It builds the app a second time, and a
  first import tells you everything a dry run would.
- **No `npm`.** After step 1 there is no `package.json` to run it against.
- **No browser.** A pod app puts a Lemma sign-in in front of every visitor. That
  session belongs to a person; an agent has none and cannot get one. Verification
  is reading the pod back — `lemma pods describe`, `lemma schedules list`,
  `lemma agents permissions get <agent>`.
- **No status widget.** Loading the skill, reading a starter, writing the HTML and
  displaying it costs ninety seconds for something four sentences say better.

## Checklist

- [ ] `apps/<name>/source/` is built output; the project lives elsewhere with a
      `build.sh` that clears `VITE_LEMMA_*` and refuses to ship a uuid
- [ ] `setup.sh`: rename (isolated, first) → import (quiet, explicit app slug) →
      read back → the agent brief
- [ ] The hero is one sentence somebody says, and it produces something real
- [ ] Anything outward-facing ships off, and the note says which and why
- [ ] A `wire-<connector>.sh` for whatever needs a human OAuth round trip
- [ ] The setup prompt is three lines and mostly says what not to do
- [ ] Timed on a genuinely fresh pod, twice — the second one catches what the
      first one left behind

Worked example: everything in this repository. [setup.sh](setup.sh),
[wire-github.sh](wire-github.sh), [app/build.sh](app/build.sh),
[SETUP-PROMPT.md](SETUP-PROMPT.md), and the reasoning in [AGENTS.md](AGENTS.md).
