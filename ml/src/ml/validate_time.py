"""Report strictly temporal two-month validation metrics and subgroup performance."""
import argparse
import json
import numpy as np
import pandas as pd
from sklearn.metrics import r2_score
from .config import load_config
from .ingest import load_inputs
from .train import RentModel


def metrics(actual, prediction):
    error = np.abs(np.asarray(actual) - np.asarray(prediction))
    return {'MedAE': float(np.median(error)) if len(error) else None,
            'within_100_pct': float(100 * np.mean(error <= 100)) if len(error) else None,
            'MAE': float(np.mean(error)) if len(error) else None,
            'R2': float(r2_score(actual, prediction)) if len(error) > 1 and np.var(actual) > 0 else None,
            'n': len(error)}


def validate(inputs, config, include_m2=True):
    report = {'data_mode': inputs.audit['data_mode'], 'synthetic_warning': 'Synthetic results do not establish real-data accuracy.',
              'cutoff': config['cutoff'], 'benchmark': {'MedAE': 86., 'within_100_pct': 55.21}, 'folds': []}
    pooled = {name: ([], []) for name in (['m0', 'm1', 'm2'] if include_m2 else ['m0', 'm1'])}
    for cutoff in ['2026-01-31', '2026-03-31']:
        end = pd.Timestamp(cutoff) + pd.offsets.MonthEnd(2)
        targets = inputs.leases.loc[(inputs.leases.date > cutoff) & (inputs.leases.date <= end)].reset_index(drop=True)
        if targets.empty:
            raise ValueError(f'No validation leases for fold {cutoff}; inspect date mapping and coverage')
        model = RentModel(inputs.flats, inputs.leases, cutoff, 'm2' if include_m2 else 'm1', config['seed'], config['block_stats_as_of'], config.get('mask_post_cutoff_attributes', False))
        features = model.store.transform(targets, targets.date)
        # Scoring uses the same paired scenarios and ordering constraint as the submission.
        without_query, with_query = targets.copy(), targets.copy()
        without_query['car_spaces'], with_query['car_spaces'] = 0., 1.
        without_features = model.store.transform(without_query, targets.date)
        with_features = model.store.transform(with_query, targets.date)
        fold = {'cutoff': cutoff, 'target_end': str(end.date()), 'latest_feature_source': str(model.store.history_max_date),
                'training_audit': model.training_audit, 'models': {}}
        actual = targets.rent.to_numpy()
        for name in pooled:
            without = model.predict_features(without_features, name)
            with_car = np.maximum(without, model.predict_features(with_features, name))
            known = features.parking_known.eq(1).to_numpy()
            prediction = np.where(known, np.where(targets.car_spaces.fillna(0).to_numpy() > 0, with_car, without),
                                  (with_car + without) / 2)
            groups = {'all': np.ones(len(targets), dtype=bool),
                      'has_own_history_yes': features.has_own_history.eq(1).to_numpy(),
                      'has_own_history_no': features.has_own_history.eq(0).to_numpy(),
                      'parking_known': known, 'parking_unknown': ~known}
            fold['models'][name] = {group: metrics(actual[mask], prediction[mask]) for group, mask in groups.items()}
            pooled[name][0].extend(actual.tolist())
            pooled[name][1].extend(prediction.tolist())
        report['folds'].append(fold)
    report['pooled'] = {name: metrics(*values) for name, values in pooled.items()}
    destination = config['paths']['artifacts']
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'metrics.json').write_text(json.dumps(report, indent=2, allow_nan=False), encoding='utf-8')
    for fold in report['folds']:
        for name, values in fold['models'].items():
            m = values['all']
            print(f"{fold['cutoff']} {name.upper()}: MedAE=${m['MedAE']:.2f}, within $100={m['within_100_pct']:.2f}%, MAE=${m['MAE']:.2f}, R2={m['R2']:.4f}, n={m['n']}")
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', choices=['synthetic', 'real'], default='synthetic')
    config = load_config()
    validate(load_inputs(config, parser.parse_args().data), config)
