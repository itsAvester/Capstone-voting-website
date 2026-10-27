# Search Arena: English-only human review (500 observations)

This update removes the promotional left panel and header branding from **sign-in**, centers the reviewer form, **removes `/demo` entirely**, and uses **four-digit numeric reviewer PINs** with Supabase-backed login throttling. The response-comparison workspace is otherwise unchanged.

## Requirements

- Node.js 20.9+ and npm (Node 24 is supported by the site's declared engine range).
- Python with `pandas`, `numpy`, `pyarrow`, `datasets`, and **`langdetect`** to create the batch.
- Your existing Supabase project or a new one. This project stores no original model-name information in reviewer-facing tables.

## First, generate the correct 500 observations

From a PowerShell terminal in this project directory:

```powershell
python -m pip install pandas numpy pyarrow datasets langdetect
python .\prepare_search_arena_reviews_english.py --parquet "C:\path\to\search-arena-chat-24k.parquet" --outdir .\data\review_batch_english
```

Alternatively, use `--source-hf` instead of `--parquet` to load `lmarena-ai/search-arena-24k` from Hugging Face:

```powershell
python .\prepare_search_arena_reviews_english.py --source-hf --outdir .\data\review_batch_english
```

The script filters **only records with missing original `winner`** (not explicit tie/both-bad), and requires that **every value in `languages` be an English language tag**. It checks both final displayed model answers with `langdetect`, keeping short ambiguous answers if they contain no substantial non-Latin script. Then it proportionally samples 500 across `primary_intent`, creates 1,000 assignments, with 50 observations for each of the 10 reviewer pairs. Sample and assignment random seeds are fixed.

> Filtering is automated, not a guarantee that every character of every conversation is English. Before importing, manually examine a random sample. The script records candidate counts, selection criteria, and uncertainty in `sampling_manifest.json`.

Files created: `review_items.json`, `initial_assignments.csv`, `sampling_manifest.json`, `english_audit_sample.csv` (30 examples to check), and **private** `private_model_lookup.json`. Never publish the private lookup: it maps original model identities to reviewed observations. The `data/` folder is gitignored.

## Supabase migration: IMPORTANT if you previously imported the other 500

1. **Pause the site / do not invite reviewers** during a dataset replacement.
2. In Supabase SQL Editor, run:

   ```sql
   select count(*) as existing_votes from public.votes;
   select count(*) as existing_observations from public.observations;
   ```
3. **If `existing_votes` is 0**, you can run `sql/03_reset_unvoted_batch.sql` **once**. It deletes the old observations and assignments but keeps your reviewer names. It uses a database transaction and **refuses to delete anything if even one vote exists**.
4. **If any votes exist, DO NOT reset**. Keep the study untouched and create a fresh Supabase project for the English-only cohort (or back up/migrate under a separate project with a documented data plan). The new database needs `sql/01_schema.sql` first.
5. Run `sql/02_login_rate_limit.sql` in **either** your existing or new project. It adds safe shared throttling for four-digit PIN logins and is required by the new login route.
6. In `.env.local` (and in Vercel's environment variables) set `REVIEWER_1_PIN` ... `REVIEWER_5_PIN` to **five distinct four-digit strings**. If an existing PIN has 8+ characters, you must replace it. Keep `ADMIN_EXPORT_PIN` long and separate; do **not** shorten the admin password.

**There is no website auto-reset.** Old observation IDs must be cleared deliberately before importing a different 500; the resumable importer refuses to silently mix datasets.

## Import the English-only batch

```powershell
npm install
npm run import:batch -- --dir ./data/review_batch_english --check-only
npm run import:batch -- --dir ./data/review_batch_english
```

The importer specifically checks the English-only sampling manifest and language codes, plus exactly 500 unique source rows and a balanced 1,000 initial assignments. It resumes partial network uploads without overwriting previously imported rows, **but only when those rows match the current batch**.

## Run and deploy

```powershell
npm run dev
```

Open `http://localhost:3000/` and sign in with your reviewer ID and four-digit PIN. `http://localhost:3000/demo` now returns 404. To deploy, push source code to a **private** GitHub repo, import it into Vercel and configure the same server-side environment variables. Redeploy whenever changing Vercel environment variables.

Full checklist: [SUPABASE_TODO.md](SUPABASE_TODO.md).

## Methodology notes

- A/B sides are randomized independently; the model identities and original `winner` remain hidden.
- Two initial independent reviewers assess each observation; a third is assigned only after disagreement or an abstention requiring replacement.
- Two agreeing valid choices settle the result. Three different choices are marked unresolved, not forced into A/B.
- `tie` (judged responses equal) is a review choice; **reviewer disagreement** is what triggers a third vote.
- The resulting annotations are *team preferences*, not the original users' votes. Keep them separate in analysis; preserve missing/undecided/tie/both-bad outcomes.
- Source row IDs refer to the original dataset row order. Keep the Parquet source ordering stable for merging results.

## Security

Reviewer PINs are intentionally short per project requirements; they are **not as strong as normal passwords**. `sql/02_login_rate_limit.sql` enforces a modest 5-attempt-per-15-minute limit per reviewer and connecting IP, and the app uses signed HttpOnly cookies. This does not fully eliminate online attack risk, especially across many IPs; for a publicly reachable site use Vercel Deployment Protection or replace PIN auth with full identities. Never expose service-role secrets in client code or Git.
