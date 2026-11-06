"""Map input schemas, quarantine future leases, and clean canonical tables."""
from dataclasses import dataclass
import argparse
import pandas as pd
import numpy as np
from .config import load_config


@dataclass
class Inputs:
    flats: pd.DataFrame
    leases: pd.DataFrame
    holdout: pd.DataFrame
    audit: dict


def parse_dates(values):
    return pd.to_datetime(values, errors='coerce', format='mixed', utc=True).dt.tz_localize(None).dt.normalize()


def mapped_read(path, mapping, required):
    raw = pd.read_csv(path, dtype=str, encoding='utf-8')
    missing = [key for key in required if mapping.get(key) not in raw.columns]
    if missing:
        raise ValueError(f'{path.name}: missing mapped columns: {missing}')
    sources = [value for value in mapping.values() if value is not None]
    if len(sources) != len(set(sources)):
        raise ValueError('Each source column must map to exactly one canonical column')
    return pd.DataFrame({key: raw[source] if source in raw else pd.Series(np.nan, index=raw.index)
                         for key, source in mapping.items()})


def clean_leases(leases, flats, cutoff, synthetic=False):
    leases = leases.copy()
    leases['gnaf_id'] = leases.gnaf_id.astype('string').str.strip()
    leases['date'] = parse_dates(leases.date)
    for col in ['rent', 'bedrooms', 'bathrooms', 'car_spaces']:
        leases[col] = pd.to_numeric(leases[col], errors='coerce')
        leases.loc[~np.isfinite(leases[col]), col] = np.nan
    leases.loc[~leases.car_spaces.between(0, 20), 'car_spaces'] = np.nan
    for col in ['bedrooms', 'bathrooms']:
        leases.loc[~leases[col].between(0, 20), col] = np.nan
    leases = leases.loc[leases.date.notna() & leases.date.ge('1900-01-01') & leases.rent.gt(0)
                         & leases.gnaf_id.isin(flats.gnaf_id)].drop_duplicates()
    cutoff = pd.Timestamp(cutoff)
    past = leases.loc[leases.date <= cutoff].reset_index(drop=True)
    future = leases.loc[leases.date > cutoff].reset_index(drop=True) if synthetic else leases.iloc[:0].copy()
    return past, future


def load_inputs(config, mode='synthetic', persist=True):
    if mode not in ('synthetic', 'real'):
        raise ValueError('Data mode must be synthetic or real')
    folder = config['paths']['raw'] / ('synthetic' if mode == 'synthetic' else '')
    flats = mapped_read(folder / config['files']['flats'], config['columns']['flats'],
                        ['gnaf_id', 'building_address', 'suburb', 'mb', 'bedrooms'])
    flats['gnaf_id'] = flats.gnaf_id.astype('string').str.strip()
    if flats.gnaf_id.isna().any() or flats.gnaf_id.eq('').any() or flats.gnaf_id.duplicated().any():
        raise ValueError('Flat identifiers must be nonempty and unique')
    numeric = ['bedrooms', 'bathrooms', 'car_spaces', 'floor_level', 'flats_in_building',
               'latitude', 'longitude', 'block_new_homes_2021_2026', 'block_homes_2026']
    for col in numeric:
        flats[col] = pd.to_numeric(flats[col], errors='coerce').replace([np.inf, -np.inf], np.nan)
    # A boolean parking flag is an optional fallback when counts are absent.
    flag = flats.car_space.astype('string').str.lower().map({'true': 1., 'false': 0., 'yes': 1., 'no': 0., '1': 1., '0': 0.})
    flats['car_spaces'] = flats.car_spaces.fillna(flag)
    for col in ['first_ever_listed', 'attrs_last_seen']:
        flats[col] = parse_dates(flats[col])
    blocks = mapped_read(folder / config['files']['blocks'], config['columns']['blocks'], ['mb'])
    if blocks.mb.duplicated().any():
        raise ValueError('Block identifiers must be unique; aggregate the block file first')
    for col in ['block_new_homes_2021_2026', 'block_homes_2026']:
        block_value = pd.to_numeric(blocks[col], errors='coerce')
        flats[col] = flats.mb.map(pd.Series(block_value.to_numpy(), index=blocks.mb)).combine_first(flats[col])
    raw = mapped_read(folder / config['files']['leases'], config['columns']['leases'], ['gnaf_id', 'date', 'rent'])
    past, future = clean_leases(raw, flats, config['cutoff'], synthetic=mode == 'synthetic')
    audit = {'input_leases': len(raw), 'modelling_leases': len(past), 'synthetic_holdout': len(future),
             'latest_modelling_date': str(past.date.max()), 'data_mode': mode}
    if past.empty:
        raise ValueError('No valid pre-cutoff leases remain')
    if persist:
        destination = config['paths']['cutoff'] / mode
        destination.mkdir(parents=True, exist_ok=True)
        past.to_csv(destination / 'leases.csv', index=False)
        if mode == 'synthetic':
            future.to_csv(destination / 'synthetic_holdout.csv', index=False)
    return Inputs(flats, past, future, audit)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', choices=['synthetic', 'real'], default='synthetic')
    print(load_inputs(load_config(), parser.parse_args().data).audit)
