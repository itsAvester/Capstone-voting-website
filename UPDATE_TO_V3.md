# Version 3 update — compact voting and reason keywords

**No new sampling or importing is needed.** Keep the 500 English-only observations already in Supabase. The update adds vote-reason fields without deleting observations, assignments, previous votes, reviewer profiles, or PINs.

## Update existing Supabase project — do this first

1. Stop reviewers from submitting new votes during the brief update.
2. In Supabase **SQL Editor**, open and run `sql/04_vote_reasons.sql` from this ZIP.
   - It **adds** `votes.reason_tags` (JSON), `votes.reason_keywords` (text), and `votes.reason_keywords_target` (canonical `a`/`b`/`both`).
   - It replaces the 3-argument vote-saving RPC with the version that accepts reason fields, and preserves the existing 2+1 agreement workflow.
   - It is wrapped in one SQL transaction. **Do not** re-run `sql/01_schema.sql` or any reset script on your existing study.
   - Earlier votes are retained, with empty reasons by default.
3. Replace the website project source with the files from this ZIP. **Keep** your existing `.env.local` and your `data/` directory unchanged. Avoid copying over your `node_modules` directory.
4. In PowerShell inside the website folder:

   ```powershell
   npm install
   npm run typecheck
   npm run dev
   ```

5. Open `http://localhost:3000`, sign in as usual, verify progress and the first comparison, then push the updated code to GitHub for Vercel deployment.

   ```powershell
   npm run build
   git add .
   git commit -m "Compact review workspace and structured vote reasons"
   git push
   ```

6. After Vercel finishes redeploying, let the rest of the reviewers resume.

## New layout

- The large workspace heading, description, empty padding, and response-introduction section have been removed.
- Progress is kept visible in the small row at the top.
- On normal desktop windows (at least about 850 px wide and 700 px tall), the workspace fits in the browser viewport without page-level scrolling; the original prompt and long responses each remain independently scrollable so their complete contents are accessible.
- On narrow/mobile windows or unusually short screens, the page can scroll for accessibility; showing all text at once would mean hiding or shrinking content too far.
- Vote buttons, reason chips, keyword field, and Submit & next stay below the response panels.
- Previously available contextual chat history remains accessible within each response's scrollable pane.
- A small Admin export control remains at the bottom for the coordinator.

## Annotation instructions

1. Read the prompt and responses **A** and **B**.
2. Choose **A**, **B**, **Tie**, **Both poor**, or **Skip**. Keyboard shortcuts 1–5 continue to work when not typing.
3. Optionally choose which response your reason applies to — `A`, `B`, or `Both` — and click up to eight tags. You can change the target and select tags for a second response if necessary. Selected tags retain their original target even when the selector changes.
4. Optionally enter brief comma-separated keywords in **Other keywords** (limit: 160 characters). The keywords are associated with the currently selected target.
5. Click **Submit & next**. The vote and reasons are saved atomically in one Supabase function call, and the next item appears.

When voting for A, the default reason target becomes B (the losing response), and vice versa. For ties, both-poor judgments, and skips, the default target is `Both`. You can override this at any point. Avoid treating *no citations* as a flaw when the prompt does not require factual support.

### Standard reason codes (stored as snake_case)

| Code | Label |
| --- | --- |
| `refused_punted` | Refused / punted |
| `no_citations` | No citations |
| `broken_citations` | Broken citations |
| `unsupported_claim` | Unsupported claim |
| `factual_error` | Factual error |
| `incomplete` | Incomplete |
| `off_topic` | Off-topic |
| `too_vague` | Too vague |
| `too_verbose` | Too verbose |
| `poor_formatting` | Poor formatting |
| `better_sourcing` | Better sourcing |
| `more_useful` | More useful |
| `missing_context` | Missing context |

These are **descriptive reviewer annotations**, not automatic winner-deciding rules and not verified factual diagnoses. Reasons are optional to avoid overburdening the review study.

## Export format

- **Individual votes CSV**: contains `reason_tags` (e.g., `[{"code":"no_citations","applies_to":"b"}]`), `reason_keywords`, and `reason_keywords_target` with the canonical side `a`, `b`, or `both`. It also contains the existing observation ID, reviewer ID, choice, and timestamp.
- **Consensus CSV**: retains the previous counts and overall winner; the `reviewer_votes` JSON cell now includes each voter's reason metadata.
- Because side positions are randomized, the API converts visible `A`/`B` in reason annotations to the original `response_a`/`response_b` before saving. This is important for analysis and for joining back to your Search Arena source IDs.

**Test caveat:** the updated TypeScript/TSX source has been syntax-checked, but a full Next.js compilation and live Supabase migration have not been executed in this environment. Run `npm run typecheck` and `npm run build` locally before deploying, and verify one vote on the updated interface when your team is ready. 
