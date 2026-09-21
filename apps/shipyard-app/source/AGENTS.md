# The Shipyard app

React + Vite, served into a Lemma pod. `DESIGN.md` one level up is the real
document: it says why each screen is shaped the way it is, and it is where the
traps are written down.

## Running it

```bash
npm install
npm run dev     # authenticated as whoever the Lemma CLI is logged in as
```

`npm run dev` asks the CLI for a token and seeds it before the bundle boots, so any
browser pointed at the dev URL is signed in. That token is never written to a file
and the plugin does not run in `vite build`.

```bash
lemma apps deploy shipyard-app . --yes
```

## Pod context is injected, never baked

`new LemmaClient()` takes no arguments. The host injects `window.__LEMMA_CONFIG__`
(`podId`, `apiUrl`, `authUrl`) when it serves the app, so the same build runs
against any pod on any deployment. `.env.local` is a dev-only fallback for
`vite dev`, where the host is not in the loop — it is gitignored, and nothing in
`src/` should read a pod id from anywhere else.

## Things that will bite you

Each of these cost a debugging session; all are explained in `../DESIGN.md`.

- **`conversations.messages.send` does not return until the agent's whole turn
  ends.** Await it before showing a thread and the UI hangs for minutes.
- **Never send a message from a `useEffect`.** StrictMode tears it down and the
  send dies with `signal is aborted without reason`. Sending belongs to the click.
- **A run started outside `useConversationMessages` is invisible to it** — poll
  `resumeIfRunning` or the screen looks dead while the agent works.
- **`messages.list(id, {limit: 1})` returns the NEWEST message.** For the opening
  one, ask for `before_sequence: 1`.
- **A connect request needs an auth config to already exist**, returns
  `authorization_url` (not `redirect_url`), and its `return_to` only accepts a
  rooted path inside the Lemma app — so this app can never be the OAuth callback
  and watches for the account instead.
- **Pod members and organization members have different shapes.** Normalise both
  at the edge; reading one as the other renders a list of "Someone".
- **GitHub has no "merged" state.** A merged pull request is closed with a merge
  date.

## Conventions

- Comments say *why*. If a comment restates the code, delete it or rename the thing.
- Nothing is heavier than font-weight 500, including rendered Markdown.
- Machine-generated values are monospace; human sentences are sans.
- Status is a coloured dot **and** a word, never colour alone.
- Never poll a table — subscribe through the shared socket in `lib/app-context`.
