"""Predict both parking scenarios starting from every input identifier."""
import argparse
import numpy as np
import pandas as pd
from .config import load_config
from .ingest import load_inputs
from .train import RentModel


def predict_pairs(model, flats, horizon):
    ids = flats[['gnaf_id']].reset_index(drop=True)
    scenarios = []
    for parking in (0., 1.):
        query = ids.assign(car_spaces=parking)
        prediction = model.predict(query, horizon)
        fallback = model.store.global_rent
        scenarios.append(np.maximum(1, np.nan_to_num(prediction, nan=fallback, posinf=fallback, neginf=fallback)))
    without = np.round(scenarios[0], 2)
    with_car = np.round(np.maximum(scenarios[1], without), 2)
    predictions = pd.DataFrame({'gnaf_id': ids.gnaf_id, 'rent_with_car_space': with_car,
                                'rent_without_car_space': without})
    return ids.merge(predictions, on='gnaf_id', how='left', validate='one_to_one')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', choices=['synthetic', 'real'], default='synthetic')
    parser.add_argument('--model', choices=['m0', 'm1', 'm2'], default='m0')
    args = parser.parse_args()
    config = load_config()
    inputs = load_inputs(config, args.data)
    model = RentModel(inputs.flats, inputs.leases, config['cutoff'], args.model, config['seed'], config['block_stats_as_of'], config.get('mask_post_cutoff_attributes', False))
    print(predict_pairs(model, inputs.flats, config['horizon']).head().to_string(index=False))
