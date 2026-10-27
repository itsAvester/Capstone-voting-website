# Supabase & Vercel to-do — English-only batch

The site still uses the original four tables (`reviewers`, `observations`, `assignments`, `votes`), so you do **not** need to rerun the main schema against an existing project.

## 1. Confirm where your current data stands

- [ ] Keep other reviewers off the website until replacement finishes.
- [ ] In **Supabase → SQL Editor**, run:

  ```sql
  select count(*) as existing_votes from public.votes;
  select count(*) as existing_observations from public.observations;
  ```

- [ ] If `existing_votes = 0`, run **`sql/03_reset_unvoted_batch.sql`** once to remove the *previous* 500 observations and their assignments. **This deletes the previous imported observations.** It refuses to proceed if any votes exist; you must approve/execute it yourself.
- [ ] If `existing_votes > 0`, **do not run the reset**. Prefer a new Supabase project to protect existing research votes; run `sql/01_schema.sql` there and update your Supabase credentials.

## 2. Add four-digit PIN protection

- [ ] Run `sql/02_login_rate_limit.sql` in SQL Editor (safe on an existing schema).
- [ ] In `.env.local`, set five distinct, **exactly four-digit numeric** values for `REVIEWER_1_PIN` … `REVIEWER_5_PIN`. Do not use the same PIN twice. Leading zeros count: `0294` is valid.
- [ ] Keep `ADMIN_EXPORT_PIN` **at least eight characters** and distinct from reviewer PINs.
- [ ] Keep `APP_SESSION_SECRET` **at least 32 characters**; retain or generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- [ ] Keep `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` server-only. No `NEXT_PUBLIC_` prefix.
- [ ] Update those same values in **Vercel → Project → Settings → Environment Variables**, then redeploy.

## 3. Create 500 English-only, unvoted observations

Run from your site's folder in PowerShell:

```powershell
python -m pip install pandas numpy pyarrow datasets langdetect
python .\prepare_search_arena_reviews_english.py --parquet "C:\path\to\your-file.parquet" --outdir .\data\review_batch_english
```

Or, without a local Parquet file:

```powershell
python .\prepare_search_arena_reviews_english.py --source-hf --outdir .\data\review_batch_english
```

- [ ] Check the printed counts: only original missing `winner` values, English-only `languages` metadata, both displayed answers screened for English, 500 selected, 1,000 initial assignments, 200/reviewer, 50/pair.
- [ ] Inspect `english_audit_sample.csv` (30 randomly selected examples), and spot-check full responses if needed.
- [ ] Preserve `sampling_manifest.json` and `private_model_lookup.json` somewhere **private**, for methodology and A/B model mapping. The `data/` directory is gitignored.

## 4. Import safely

```powershell
npm install
npm run import:batch -- --dir ./data/review_batch_english --check-only
npm run import:batch -- --dir ./data/review_batch_english
```

- [ ] First output says `VALID ENGLISH-ONLY UNVOTED SAMPLE`.
- [ ] Second output says `Done: 500 observations, 1000 assignments, five reviewers.`
- [ ] Verify 500 rows in `observations`, 1,000 in `assignments`, and 0 in `votes`.
- [ ] If `fetch failed`, retry the same import; it resumes. If it says the dataset does not match existing rows, stop and review Step 1. Do **not** force the import.

## 5. Verify the updated interface

- [ ] Run `npm run dev` and open `http://localhost:3000`.
- [ ] Confirm the sign-in card is centered, the left promotional panel and top-left branding are gone on sign-in, and preview link is gone.
- [ ] Confirm `http://localhost:3000/demo` returns **404**.
- [ ] Confirm only numeric, four-digit reviewer PINs can be entered and authenticated.
- [ ] Confirm invalid PINs fail, and repeated guesses get a temporary login block.
- [ ] Check that each reviewer can save a vote. **Only test with real votes when ready:** submitted votes are permanent in the website.
- [ ] Confirm the pairwise comparison, agreement logic, third-reviewer assignment, and admin export work.
- [ ] Run `npm run typecheck` and `npm run build` before deployment.

## 6. Deploy

- [ ] Commit source code to your private GitHub repo. Do **not** commit `.env.local`, `data/`, reviewer PINs, dataset exports, or keys.
- [ ] Push to GitHub; redeploy on Vercel.
- [ ] Share each reviewer's own PIN privately.
- [ ] Export individual-vote and consensus CSVs when annotation ends. Preserve the sampling manifest and source row indices for your capstone.

**Short PIN security:** The DB-backed limit mitigates repeated guessing from a single IP, but cannot fully protect against distributed guessing. Use deployment protection or a stronger sign-in method if the site is exposed publicly.

## Version 3 follow-up (existing English-only batch)

- [ ] **Do not run `sql/03_reset_unvoted_batch.sql` when updating an existing batch.** The original 500 observations and votes stay as they are.
- [ ] Before deploying the new code, run `sql/04_vote_reasons.sql` in Supabase SQL Editor to add reason metadata and update the voting RPC.
- [ ] Replace the site source files but retain `.env.local`, reviewer PINs and any `data/` files.
- [ ] Run `npm run typecheck` and `npm run build` locally, then deploy and test the updated vote export.
- [ ] See `UPDATE_TO_V3.md` for all changes, including the keyword taxonomy and A/B attribution.
