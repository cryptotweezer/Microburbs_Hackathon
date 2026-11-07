# Rent prediction pipeline

Python 3.11 / uv. All paths in `config.yaml` resolve relative to that file. No API calls or real data are needed for a synthetic run.

From the repository root:

```powershell
cd ml
uv run pytest -q
uv run python -m ml.make_submission --data synthetic --model m0
uv run python -m ml.make_submission --data synthetic --model m2
uv run python -m ml.check_submission ../data/submissions/rents_team-name.csv
```

In an environment where the preinstalled `.venv` is read-only, first set `$env:UV_NO_SYNC = '1'`. This uses the already installed dependencies without trying to reinstall the editable package. The uv cache and pytest temporary files stay inside `ml/`. The existing `native-tls` setting is retained; newer uv versions emit a deprecation warning.

The synthetic CLI deterministically regenerates its inputs on every run. Full-size output has 65,777 rows. M0 validates M0 and M1; M2 validates all three models. `data/artifacts/metrics.json` describes the **latest run**, including both folds, subgroup metrics, pooled metrics, training snapshot dates, ingestion counts, output validation, and runtime. Output CSVs and metrics from later runs replace earlier ones. Synthetic and real modes share the configured artifact/submission paths: use separate configurations to retain both.

## Running on the organisers' data

1. The organisers' files are not in this repo (judges already have them). Place the three Task 4 CSVs (`rents-input-flats-city-of-sydney.csv`, `rents-past-leases-city-of-sydney.csv`, `blocks-homes-and-people-2021-2026.csv`) in `data/raw/task4/` at the repo root, or change `paths.raw` and `files` in `config.yaml`.
2. Edit `columns`: keys are canonical names, values are source column names. Keep canonical keys; use `null` for unavailable optional fields. Block IDs and GNAF IDs are read as strings, preserving leading zeros. Extra input columns are ignored.
3. Set `team`, then run `uv run python -m ml.make_submission --data real --model m2`.
4. Independently check with `uv run python -m ml.check_submission ../data/submissions/rents_<team>.csv --data real`.

Required flat fields are `gnaf_id`, `building_address`, `suburb`, `mb`, and `bedrooms`; required lease fields are `gnaf_id`, `date`, `rent`; blocks require `mb`. Other mapped fields may be absent. The flat file must have exactly 65,777 unique, nonempty IDs. Duplicate block IDs fail rather than silently multiplying rows. Missing optional numeric features remain missing for LightGBM or use median fallbacks. No usable pre-cutoff leases or no targets in a required validation fold fails with an actionable error.

Check these source assumptions before relying on real metrics:

- Rent is a positive numeric **weekly AUD** amount; no currency symbols, ranges, monthly values, or bond amounts. Dates are advertised dates, not lease end dates. ISO date strings are preferable; ambiguous dates currently use pandas' month-first interpretation. Naive dates are interpreted as UTC calendar dates, and aware dates normalize to UTC.
- Lease rows represent flat advertisements; IDs refer to the same physical units. There is no automatic crosswalk or fuzzy address matching. Exact canonical duplicates are removed; different prices for the same unit/date remain distinct observations.
- `building_address` is a stable, globally unique building key. If not, map it to a prepared building ID. Missing building values receive unit-specific fallback keys.
- Parking counts are nonnegative counts, with missing meaning unknown; any positive count is treated as **one or more spaces**. The requested “with car space” scenario means at least one space. Multiple-space premiums are not separately modelled. Flat boolean parking flags are a fallback for missing counts.
- Bedrooms use `0` for studios. Bedrooms/bathrooms may be missing; known historical unit attributes are used before defaults. Floor level must be numeric.
- Organiser-supplied flat attributes are allowed prediction inputs even when `attrs_last_seen` is missing or after the cutoff. `mask_post_cutoff_attributes: false` preserves them by default. Set it to `true` to opt into masking beds, baths, parking, floor and building size when the observation date is missing or on/after each feature cutoff. This applies consistently to validation, residual-training snapshots and final prediction. Block-stat masking is independent and unchanged.
- `block_stats_as_of` is the conservative availability date for the supplied block statistics (default 2026-07-31). They are masked before that date. Confirm that the statistics really were available by the official cutoff; set a later date to disable them if needed. Mixed-date files need an explicit dated adapter before use. No 2026 statistics are backfilled into January/March folds.
- February–March and April–May 2026 need enough historical advertisements for validation. No real post-2026-07-31 rows are exposed to feature construction, training, or validation. Synthetic future rows are written separately as a holdout and are not used for fitting or fold scoring.

## Models and validation

Every feature store filters leases **strictly before** its cutoff, including residual-training snapshots. Ingestion accepts leases through 2026-07-31; feature stores conservatively omit the cutoff date itself. Cutoff configuration cannot exceed the official deadline. No last-rent, aggregate, parking premium, or time-trend estimator can see a later lease.

M0 uses building/bedroom/parking, suburb/bedroom/parking, city/bedroom, then global medians. Monthly bedroom-specific median rents over the preceding 36 months estimate a clipped log-linear time index. Historical rents are aligned to the snapshot month before aggregation and projected to each target month. This is a deliberately simple extrapolation; pandemic shifts and sparse real strata may require refinement.

Parking premiums use nonnegative within-bedroom differences with and without parking, pooled from city to suburb to building using support shrinkage `n/(n+10)`. Values are capped at $400 at the snapshot date for robustness. Unknown parking is represented by a half-premium for normalizing historical rents. This is an observational association, not a causal estimate.

M1 combines the unit's time-adjusted last rent and a parking-normalized building/bedroom median. The unit estimate receives weight `n/(n+10)`, where `n` is its own prior lease count; building estimates fall back through suburb and city. Target parking premium is added afterward. M2 fits LightGBM `objective=regression_l1` to M1 residuals from three disjoint six-month historical target windows. Each window's features use an earlier frozen snapshot; target rents cannot enter their own features. Very small datasets fall back to M1 when fewer than 100 residual-training examples exist.

Validation cutoffs are January 31 and March 31, predicting February–March and April–May respectively. Features use each target's advertisement attributes and date, but never its rent. All models use the same scenario pairing and nonnegative parking ordering as export; unknown target parking is scored using the midpoint of the two scenarios. Reports include MedAE, percentage within $100 inclusive, MAE, R2 and n, split by own-history availability and observed parking. Subgroups with no rows have null metrics; undefined R2 is null.

Export starts from every input ID and checks the serialized temporary CSV before atomic replacement. Wrong row counts, IDs, columns/order, index columns, nonnumeric/NaN/infinite rents, invalid UTF-8 and reversed parking prices fail validation and preserve any existing submission. Model predictions have hierarchical fallbacks and a positive floor. Synthetic scores measure pipeline behavior on the generator, **not expected real-data accuracy**.

## Individual modules

```powershell
uv run python -m ml.synth
uv run python -m ml.ingest --data synthetic
uv run python -m ml.features --data synthetic --cutoff 2026-01-31
uv run python -m ml.train --data synthetic --model m2
uv run python -m ml.validate_time --data synthetic
uv run python -m ml.predict --data synthetic --model m2
uv run python -m ml.export_submission --data synthetic --model m2
```

`train` optionally writes a LightGBM residual booster and a training audit. The booster alone is not a complete inference bundle: `make_submission` reconstructs historical stores and trains the selected model. `features` writes a diagnostic feature CSV; `predict` previews paired predictions; `export_submission` runs the checked end-to-end exporter.
