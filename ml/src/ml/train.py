"""Fit L1 residual models using historical out-of-time feature snapshots."""
import numpy as np
import pandas as pd
from lightgbm import LGBMRegressor
from .features import FeatureStore


class RentModel:
    def __init__(self, flats, leases, cutoff, model='m0', seed=42, block_stats_as_of='2026-07-31', mask_post_cutoff_attributes=False):
        if model not in ('m0', 'm1', 'm2'):
            raise ValueError(f'Unknown model: {model}')
        self.model = model
        cutoff = pd.Timestamp(cutoff)
        eligible = leases.loc[leases.date < cutoff].copy()
        self.store = FeatureStore(flats, eligible, cutoff, block_stats_as_of, mask_post_cutoff_attributes)
        self.residual = None
        self.training_audit = []
        if model == 'm2':
            frames, targets = [], []
            # Disjoint target windows. Each row gets features from an earlier snapshot.
            for months in (18, 12, 6):
                origin = cutoff - pd.DateOffset(months=months)
                end = min(origin + pd.DateOffset(months=6), cutoff)
                targets_in_window = eligible.loc[(eligible.date > origin) & (eligible.date < end)]
                if targets_in_window.empty:
                    continue
                snapshot = FeatureStore(flats, eligible, origin, block_stats_as_of, mask_post_cutoff_attributes)
                features = snapshot.transform(targets_in_window.reset_index(drop=True), targets_in_window.date)
                frames.append(features)
                targets.append(targets_in_window.rent.to_numpy() - features.m1.to_numpy())
                self.training_audit.append({'feature_cutoff': str(origin.date()),
                    'latest_source': str(snapshot.history_max_date), 'earliest_target': str(targets_in_window.date.min()),
                    'latest_target': str(targets_in_window.date.max()), 'n': len(features)})
            if frames:
                x = pd.concat(frames, ignore_index=True)
                y = np.concatenate(targets)
                if len(x) >= 100:
                    self.residual = LGBMRegressor(objective='regression_l1', n_estimators=220,
                        learning_rate=.045, num_leaves=25, max_depth=7, min_child_samples=50,
                        reg_lambda=5., n_jobs=2, random_state=seed, verbosity=-1,
                        deterministic=True, force_col_wise=True)
                    self.residual.fit(x, y)

    def predict_features(self, features, model=None):
        model = model or self.model
        baseline = features['m0' if model == 'm0' else 'm1'].to_numpy()
        if model == 'm2' and self.residual is not None:
            baseline = baseline + self.residual.predict(features)
        return np.clip(baseline, 1, None)

    def predict(self, query, horizon):
        return self.predict_features(self.store.transform(query, horizon))


if __name__ == '__main__':
    import argparse
    import json
    from .config import load_config
    from .ingest import load_inputs
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', choices=['synthetic', 'real'], default='synthetic')
    parser.add_argument('--model', choices=['m0', 'm1', 'm2'], default='m2')
    args = parser.parse_args()
    config = load_config()
    inputs = load_inputs(config, args.data)
    fitted = RentModel(inputs.flats, inputs.leases, config['cutoff'], args.model, config['seed'], config['block_stats_as_of'], config.get('mask_post_cutoff_attributes', False))
    output = config['paths']['artifacts']
    output.mkdir(parents=True, exist_ok=True)
    if fitted.residual is not None:
        fitted.residual.booster_.save_model(str(output / 'm2_residual.txt'))
    (output / 'training_audit.json').write_text(json.dumps({'model': args.model,
        'cutoff': config['cutoff'], 'snapshots': fitted.training_audit}, indent=2), encoding='utf-8')
    print(f'Trained {args.model.upper()}; training audit written to {output}')
