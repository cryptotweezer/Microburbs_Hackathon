"""Independently re-read a UTF-8 submission and enforce the official CSV contract."""
import argparse
from pathlib import Path
import numpy as np
import pandas as pd
from .config import load_config

COLUMNS = ['gnaf_id', 'rent_with_car_space', 'rent_without_car_space']


def check_submission(path, input_ids, expected_rows=65777):
    # Strict decoding happens before pandas parsing; malformed UTF-8 is rejected.
    Path(path).read_bytes().decode('utf-8', errors='strict')
    frame = pd.read_csv(path, encoding='utf-8', dtype={'gnaf_id': str})
    if frame.columns.tolist() != COLUMNS:
        raise ValueError(f'Expected exactly these columns in order: {COLUMNS}')
    if len(frame) != expected_rows:
        raise ValueError(f'Expected {expected_rows:,} rows, found {len(frame):,}')
    ids = pd.Series(input_ids, dtype='string')
    if len(ids) != expected_rows or ids.isna().any() or ids.eq('').any() or ids.duplicated().any():
        raise ValueError('Input IDs do not satisfy the expected unique identifier contract')
    if frame.gnaf_id.isna().any() or frame.gnaf_id.duplicated().any() or set(frame.gnaf_id) != set(ids):
        raise ValueError('Submission IDs must be unique and equal to the input IDs')
    for col in COLUMNS[1:]:
        try:
            values = pd.to_numeric(frame[col], errors='raise').to_numpy(dtype=float)
        except (ValueError, TypeError) as error:
            raise ValueError(f'{col} must be numeric') from error
        if not np.isfinite(values).all():
            raise ValueError(f'{col} contains missing or infinite values')
        frame[col] = values
    if not (frame.rent_with_car_space >= frame.rent_without_car_space).all():
        raise ValueError('Rent with parking must be at least rent without parking')
    return {'rows': len(frame), 'columns': COLUMNS, 'valid': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('submission', type=Path)
    parser.add_argument('--data', choices=['synthetic', 'real'], default='synthetic')
    args = parser.parse_args()
    config = load_config()
    folder = config['paths']['raw'] / ('synthetic' if args.data == 'synthetic' else '')
    source = config['columns']['flats']['gnaf_id']
    ids = pd.read_csv(folder / config['files']['flats'], usecols=[source], dtype=str)[source].str.strip()
    print(check_submission(args.submission, ids, config['expected_rows']))
