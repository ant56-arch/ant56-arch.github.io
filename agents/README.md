# League agents

One read-only Claude agent per league tab, plus one for the Model Room. Each
looks at its own tab's code and data and its own model, then writes a short
report of what it sees and what it would change. **They only report.** Nothing
is changed until Anthony says so.

| Agent | Watches | Prompt |
| --- | --- | --- |
| NFL | NFL Edge tab and model (`nfl-cfb/`) | `prompts/nfl.md` |
| CFB | CFB Edge tab and model (`nfl-cfb/`) | `prompts/cfb.md` |
| MLB | MLB Edge tab and models (`mlb-nba-cbb/`, `teams/`) | `prompts/mlb.md` |
| NBA | NBA Edge tab and model (`mlb-nba-cbb/nba/`) | `prompts/nba.md` |
| NHL | NHL pages and model (`mlb-nba-cbb/nhl/`) | `prompts/nhl.md` |
| CBB | CBB Edge tab and model (`mlb-nba-cbb/cbb/`) | `prompts/cbb.md` |
| Soccer | Soccer pages and model (`mlb-nba-cbb/soccer/`) | `prompts/soccer.md` |
| Model Room | The Model Room tab, and all models side by side | `prompts/model-room.md` |

`prompts/_common.md` holds the rules every agent follows (read-only, live picks
only, no recommendations from tiny samples, the report format).

## How it runs

`.github/workflows/league-agents.yml`, Tuesdays at 9:40 AM ET after the
morning picks and Model Room runs, and on demand (Actions tab, "League Agents", Run workflow).

1. `plan` picks the agents to run. A league whose season is over
   (`python shared/seasons.py idle LEAGUE`) is skipped, so it costs nothing.
2. Each league `agent` job runs the Claude Code CLI with only the `Read`, `Grep` and
   `Glob` tools and a token that can only read the repo. It can't edit files,
   run commands or reach the web.
3. `model-agent` (the Model Room agent) runs next, with the league reports in `inbox/`.
4. `publish` collects the reports, builds one page, encrypts it with the Model
   Room password, and publishes it at `/agents/`. The repo is public, so
   reports never go in issues, logs or comments.
5. Between jobs the reports travel as run files, which anyone can download on
   a public repo, so each is locked with the same password first
   (`agents/seal.sh`) and `cleanup` deletes them when the run ends. Run the
   workflow by hand with agents `none` to delete old ones without running an agent.

## Stat scouting

Each league agent also scouts stats its model could use ("Stat ideas", up to 3,
backed by evidence from the logs). The Model Room agent runs after them, reads
every league's report, merges duplicates across sports, checks each idea against
the models and tryouts already in the Model Room, and gives a verdict on its own
tab: Worth adding, Worth testing first, or Skip. Agents can't run code, so a
verdict says how to test an idea; "test NBA-S1" tells Claude to build and
backtest it before anything goes into a model.

## One-time setup

Repo settings, Secrets and variables, Actions:

- `ANTHROPIC_API_KEY` (new): the agents' key. Without it they write a "not set
  up" report and nothing else happens.
- `MODEL_ROOM_PASSWORD` (already set): also locks `/agents/`.

## Approving a change

Each report numbers its recommendations (`NBA-1`, `NBA-2`, ...). To act on one,
tell Claude "do NBA-2". Nothing here has write access, so nothing changes
before then.

## Changing what an agent watches

Edit its prompt file. Add a league by adding a prompt and a line in `LEAGUES`
in `plan.py`.
