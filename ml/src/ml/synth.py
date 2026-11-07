"""Reproducible synthetic inputs. The generator is not a model feature source."""
import argparse
import numpy as np
import pandas as pd
from .config import load_config

SUBURBS = ['Alexandria', 'Barangaroo', 'Beaconsfield', 'Camperdown',
           'Chippendale', 'Darlinghurst', 'Darlington', 'Dawes Point',
           'Elizabeth Bay', 'Erskineville', 'Eveleigh', 'Forest Lodge', 'Glebe',
           'Haymarket', 'Millers Point', 'Newtown', 'Paddington',
           'Potts Point', 'Pyrmont', 'Redfern', 'Rosebery', 'Rushcutters Bay',
           'Surry Hills', 'Sydney', 'The Rocks', 'Ultimo', 'Waterloo', 'Woolloomooloo', 'Zetland']


def generate(n=65777, seed=42):
    rng = np.random.default_rng(seed)
    buildings = max(29, n // 32)
    b = rng.integers(0, buildings, n)
    sb = np.arange(buildings) % 29
    lat = -33.88 + rng.normal(0, .025, buildings)
    lon = 151.20 + rng.normal(0, .018, buildings)
    beds = rng.choice(5, n, p=[.13, .36, .37, .12, .02])
    cars = rng.choice(3, n, p=[.51, .44, .05])
    baths = np.minimum(3, np.maximum(1, beds - 1) + rng.binomial(1, .2, n))
    floor = rng.integers(0, 30, n)
    block = b % max(10, buildings // 3)
    flats = pd.DataFrame({'gnaf_id': [f'SYN{i:07d}' for i in range(n)],
        'address': [f'{i+1}/{j+1} Example Street' for i, j in enumerate(b)],
        'building_address': [f'{j+1} Example Street' for j in b],
        'suburb': np.array(SUBURBS)[sb[b]], 'mb': block.astype(str),
        'latitude': lat[b], 'longitude': lon[b], 'property_type': 'Flat',
        'bedrooms': beds, 'bathrooms': baths, 'car_space': cars > 0, 'car_spaces': cars,
        'floor_level': floor, 'flats_in_building': np.bincount(b, minlength=buildings)[b],
        'block_new_homes_2021_2026': 10 + block % 40,
        'block_homes_2026': 150 + block % 300,
        'ever_advertised_for_lease': True, 'first_ever_listed': '2018-01-01',
        'attrs_last_seen': np.where(np.arange(n) % 10 == 0, '2026-07-15', '2026-10-31')})
    missing = min(4246, round(n * 4246 / 65777))
    active = rng.permutation(n)[missing:]
    flat_index = np.repeat(active, rng.integers(2, 6, len(active)))
    dates = pd.Timestamp('2018-01-01') + pd.to_timedelta(rng.integers(0, 3195, len(flat_index)), unit='D')
    month = (dates.year - 2018) * 12 + dates.month - 1
    suburb_effect = np.linspace(-75, 150, 29)
    building_effect = rng.normal(0, 48, buildings)
    i = flat_index
    premium = 48 + 9 * beds[i] + 10 * (sb[b[i]] % 3)
    base = (330 + 175 * beds[i] + suburb_effect[sb[b[i]]] + building_effect[b[i]]
            + 55 * (baths[i] - 1) + 2.8 * floor[i] + premium * np.minimum(cars[i], 1)
            + 55 * (beds[i] == 0) + 32 * (floor[i] > 18))
    rent = np.maximum(150, (base * np.exp(.0035 * np.asarray(month)) + rng.normal(0, 42, len(i))))
    leases = pd.DataFrame({'gnaf_id': flats.gnaf_id.iloc[i].to_numpy(), 'date': dates.strftime('%Y-%m-%d'),
        'rent': (np.round(rent / 5) * 5), 'bedrooms': beds[i], 'bathrooms': baths[i],
        'car_spaces': np.where(rng.random(len(i)) < .12, np.nan, cars[i])})
    flats.loc[~flats.gnaf_id.isin(leases.gnaf_id), ['ever_advertised_for_lease']] = False
    flats.loc[~flats.ever_advertised_for_lease, 'first_ever_listed'] = None
    bad = leases.head(3).copy()
    bad['date'] = '0001-01-01'
    alien = leases.head(3).copy()
    alien['gnaf_id'] = ['OUTSIDE1', 'OUTSIDE2', 'OUTSIDE3']
    leases = pd.concat([leases, leases.head(50), bad, alien], ignore_index=True)
    blocks = flats[['mb', 'block_new_homes_2021_2026', 'block_homes_2026']].drop_duplicates('mb')
    return flats, leases, blocks


def write_inputs(config, n=65777):
    folder = config['paths']['raw'] / 'synthetic'
    folder.mkdir(parents=True, exist_ok=True)
    for name, frame in zip(('flats', 'leases', 'blocks'), generate(n, config['seed'])):
        # Write with the raw column names from config, so synthetic files look like the organisers' files.
        frame = frame.rename(columns=config['columns'].get(name, {}))
        frame.to_csv(folder / config['files'][name], index=False)
    print(f'Generated {n:,} synthetic flats in {folder}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rows', type=int, default=65777)
    write_inputs(load_config(), parser.parse_args().rows)
