"""Run ingestion, temporal validation, final fitting, prediction and checked export."""
import argparse
import json
import re
import time
from .config import load_config
from .synth import write_inputs
from .ingest import load_inputs
from .train import RentModel
from .validate_time import validate
from .predict import predict_pairs
from .export_submission import export_submission


def run(config, data='synthetic', model='m0'):
    started = time.perf_counter()
    if not re.fullmatch(r'[A-Za-z0-9_-]+', config['team']):
        raise ValueError('Team name may contain only letters, digits, underscores and hyphens')
    if data == 'synthetic':
        write_inputs(config, config['expected_rows'])
    inputs = load_inputs(config, data)
    if len(inputs.flats) != config['expected_rows']:
        raise ValueError(f"Expected {config['expected_rows']:,} flats, found {len(inputs.flats):,}")
    report = validate(inputs, config, include_m2=model == 'm2')
    fitted = RentModel(inputs.flats, inputs.leases, config['cutoff'], model, config['seed'], config['block_stats_as_of'], config.get('mask_post_cutoff_attributes', False))
    frame = predict_pairs(fitted, inputs.flats, config['horizon'])
    output = config['paths']['submissions'] / f"rents_{config['team']}.csv"
    result = export_submission(frame, output, inputs.flats.gnaf_id, config['expected_rows'])
    report['run'] = {'model': model, 'elapsed_seconds': round(time.perf_counter() - started, 3),
                     'submission': str(output), 'check': result, 'ingestion': inputs.audit,
                     'final_training_audit': fitted.training_audit}
    (config['paths']['artifacts'] / 'metrics.json').write_text(json.dumps(report, indent=2, allow_nan=False), encoding='utf-8')
    print(f"Valid submission: {output} ({result['rows']:,} rows)")
    print(f"Metrics: {config['paths']['artifacts'] / 'metrics.json'}")
    print(f"Elapsed: {report['run']['elapsed_seconds']:.3f} seconds")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', choices=['synthetic', 'real'], default='synthetic')
    parser.add_argument('--model', choices=['m0', 'm1', 'm2'], default='m0')
    parser.add_argument('--config', help='Path to an alternative YAML configuration')
    args = parser.parse_args()
    run(load_config(args.config), args.data, args.model)


if __name__ == '__main__':
    main()
