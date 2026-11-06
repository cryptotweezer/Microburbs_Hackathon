"""Contract, leakage and end-to-end tests for the rent pipeline."""
from copy import deepcopy
import shutil
import numpy as np
import pandas as pd
import pytest
from pandas.testing import assert_frame_equal
from ml.config import load_config
from ml.synth import generate, write_inputs
from ml.ingest import clean_leases, load_inputs
from ml.features import FeatureStore, safe_flats
from ml.train import RentModel
from ml.predict import predict_pairs
from ml.check_submission import check_submission, COLUMNS
from ml.export_submission import export_submission
from ml.make_submission import run


@pytest.fixture
def sample(tmp_path):
    config = deepcopy(load_config())
    config['paths'] = {key: tmp_path / key for key in config['paths']}
    config['expected_rows'] = 1200
    write_inputs(config, 1200)
    return config, load_inputs(config)


def test_ingestion_traps_and_holdout(sample):
    config, inputs = sample
    assert not inputs.leases.duplicated().any()
    assert inputs.leases.date.min() >= pd.Timestamp('2018-01-01')
    assert inputs.leases.date.max() <= pd.Timestamp(config['cutoff'])
    assert (inputs.holdout.date > config['cutoff']).all()
    assert len(inputs.holdout) > 0
    assert set(inputs.leases.gnaf_id) <= set(inputs.flats.gnaf_id)
    assert inputs.leases.car_spaces.isna().any()
    real = load_inputs(config, 'synthetic', persist=False)
    raw = pd.concat([real.leases, real.holdout], ignore_index=True)
    past, holdout = clean_leases(raw, real.flats, config['cutoff'], synthetic=False)
    assert holdout.empty
    assert (past.date <= config['cutoff']).all()


@pytest.mark.parametrize('cutoff', ['2026-01-31', '2026-03-31'])
def test_features_ignore_future_and_cutoff_day(sample, cutoff):
    _, inputs = sample
    base = FeatureStore(inputs.flats, inputs.leases, cutoff)
    changed = inputs.leases.copy()
    future = changed.date >= cutoff
    changed.loc[future, 'rent'] = 1e12
    changed.loc[future, 'bedrooms'] = 99
    # Include a lease exactly on the cutoff date, which must also be excluded.
    poison = changed.head(10).assign(date=pd.Timestamp(cutoff), rent=1e15)
    changed = pd.concat([changed, poison], ignore_index=True)
    contaminated = FeatureStore(inputs.flats, changed, cutoff)
    query = inputs.flats[['gnaf_id']].assign(car_spaces=1.)
    assert_frame_equal(base.transform(query, '2026-05-31'), contaminated.transform(query, '2026-05-31'))
    assert base.history_max_date < pd.Timestamp(cutoff)


def test_future_flat_attributes_and_block_stats_masked(sample):
    _, inputs = sample
    flats = inputs.flats.copy()
    flats['attrs_last_seen'] = pd.Timestamp('2026-06-01')
    first = FeatureStore(flats, inputs.leases, '2026-01-31', mask_post_cutoff_attributes=True)
    flats['floor_level'] = 9999
    flats['bedrooms'] = 99
    flats['block_homes_2026'] = 1e12
    second = FeatureStore(flats, inputs.leases, '2026-01-31', mask_post_cutoff_attributes=True)
    query = flats[['gnaf_id']]
    assert_frame_equal(first.transform(query, '2026-03-01'), second.transform(query, '2026-03-01'))


def test_default_config_preserves_supplied_attributes_after_cutoff(sample):
    config, inputs = sample
    assert config['mask_post_cutoff_attributes'] is False
    after = inputs.flats.attrs_last_seen > pd.Timestamp(config['cutoff'])
    assert after.mean() > .8
    columns = ['bedrooms', 'bathrooms', 'car_spaces', 'floor_level', 'flats_in_building']
    model = RentModel(inputs.flats, inputs.leases, config['cutoff'],
                      mask_post_cutoff_attributes=config['mask_post_cutoff_attributes'])
    assert_frame_equal(model.store.flats.loc[after, columns], inputs.flats.loc[after, columns])
    features = model.store.transform(inputs.flats[['gnaf_id']], config['horizon'])
    np.testing.assert_array_equal(features.loc[after, 'bedrooms'], inputs.flats.loc[after, 'bedrooms'])
    missing_date = inputs.flats.copy()
    missing_date['attrs_last_seen'] = pd.NaT
    preserved = safe_flats(missing_date, config['cutoff'], config['block_stats_as_of'])
    assert_frame_equal(preserved[columns], inputs.flats[columns])
    opted_in = safe_flats(inputs.flats, config['cutoff'], config['block_stats_as_of'], True)
    assert opted_in.loc[after, columns].isna().all().all()
    early = safe_flats(inputs.flats, '2026-01-31', config['block_stats_as_of'])
    assert early[['block_new_homes_2021_2026', 'block_homes_2026']].isna().all().all()


def test_residual_training_is_out_of_time_and_future_invariant(sample):
    config, inputs = sample
    cutoff = '2026-03-31'
    model = RentModel(inputs.flats, inputs.leases, cutoff, 'm2', config['seed'])
    changed = inputs.leases.copy()
    changed.loc[changed.date >= cutoff, 'rent'] = 1e12
    other = RentModel(inputs.flats, changed, cutoff, 'm2', config['seed'])
    assert model.residual is not None
    for audit in model.training_audit:
        assert pd.Timestamp(audit['latest_source']) < pd.Timestamp(audit['feature_cutoff'])
        assert pd.Timestamp(audit['earliest_target']) > pd.Timestamp(audit['feature_cutoff'])
        assert pd.Timestamp(audit['latest_target']) < pd.Timestamp(cutoff)
    np.testing.assert_array_equal(model.predict(inputs.flats[['gnaf_id']], '2026-05-31'),
                                  other.predict(inputs.flats[['gnaf_id']], '2026-05-31'))


def test_parking_and_export_no_blanks(sample, tmp_path):
    config, inputs = sample
    for name in ['m0', 'm1', 'm2']:
        model = RentModel(inputs.flats, inputs.leases, config['cutoff'], name)
        pairs = predict_pairs(model, inputs.flats, config['horizon'])
        assert (model.store.parking_premium(model.store.flats.assign(bedrooms=1)) >= 0).all()
        output = tmp_path / f'{name}.csv'
        export_submission(pairs, output, inputs.flats.gnaf_id, 1200)
        reread = pd.read_csv(output)
        assert not reread.isna().any().any()
        assert (reread.rent_with_car_space >= reread.rent_without_car_space).all()


@pytest.fixture
def full_valid():
    return pd.DataFrame({'gnaf_id': [f'ID{i}' for i in range(65777)],
                         'rent_with_car_space': 700., 'rent_without_car_space': 650.})


@pytest.mark.parametrize('corruption', ['short', 'duplicate', 'nan', 'extra', 'order', 'infinite', 'nonnumeric', 'ids', 'parking', 'index'])
def test_validator_rejects_invalid_csv(full_valid, tmp_path, corruption):
    frame = full_valid.copy()
    if corruption == 'short':
        frame = frame.iloc[:-1]
    elif corruption == 'duplicate':
        frame.loc[1, 'gnaf_id'] = frame.loc[0, 'gnaf_id']
    elif corruption == 'nan':
        frame.loc[0, COLUMNS[1]] = np.nan
    elif corruption == 'extra':
        frame['unexpected'] = 1
    elif corruption == 'order':
        frame = frame[COLUMNS[::-1]]
    elif corruption == 'infinite':
        frame.loc[0, COLUMNS[1]] = np.inf
    elif corruption == 'nonnumeric':
        frame[COLUMNS[1]] = frame[COLUMNS[1]].astype(str)
        frame.loc[0, COLUMNS[1]] = 'not-a-rent'
    elif corruption == 'ids':
        frame.loc[0, 'gnaf_id'] = 'OUTSIDE'
    elif corruption == 'parking':
        frame.loc[0, COLUMNS[1]] = 1
    output = tmp_path / 'invalid.csv'
    frame.to_csv(output, index=corruption == 'index')
    with pytest.raises(ValueError):
        check_submission(output, full_valid.gnaf_id)


def test_export_preserves_existing_file_on_failure(full_valid, tmp_path):
    output = tmp_path / 'submission.csv'
    output.write_text('existing content', encoding='utf-8')
    with pytest.raises(ValueError):
        export_submission(full_valid.iloc[:-1], output, full_valid.gnaf_id)
    assert output.read_text(encoding='utf-8') == 'existing content'
    assert list(tmp_path.glob('*.csv')) == [output]


def test_mapping_rename_is_sufficient(sample):
    config, original = sample
    folder = config['paths']['raw'] / 'synthetic'
    for kind, mapping in config['columns'].items():
        path = folder / config['files'][kind]
        frame = pd.read_csv(path)
        renames = {source: f'new_{source}' for source in mapping.values()}
        frame.rename(columns=renames).to_csv(path, index=False)
        config['columns'][kind] = {canonical: renames[source] for canonical, source in mapping.items()}
    renamed = load_inputs(config, persist=False)
    assert_frame_equal(original.flats, renamed.flats)
    assert_frame_equal(original.leases, renamed.leases)


def test_real_mode_uses_mapped_files_and_discards_future(sample):
    config, _ = sample
    for filename in config['files'].values():
        shutil.copyfile(config['paths']['raw'] / 'synthetic' / filename, config['paths']['raw'] / filename)
    report = run(config, data='real', model='m0')
    assert report['data_mode'] == 'real'
    assert report['run']['ingestion']['synthetic_holdout'] == 0
    assert pd.Timestamp(report['run']['ingestion']['latest_modelling_date']) <= pd.Timestamp(config['cutoff'])
    assert report['run']['check']['valid']


def test_no_history_and_no_known_parking_fallback(sample, tmp_path):
    config, inputs = sample
    history = inputs.leases.copy()
    history['car_spaces'] = np.nan
    history = history.loc[history.gnaf_id.isin(inputs.flats.gnaf_id.head(5))]
    for name in ['m0', 'm1', 'm2']:
        model = RentModel(inputs.flats, history, config['cutoff'], name)
        pairs = predict_pairs(model, inputs.flats, config['horizon'])
        export_submission(pairs, tmp_path / f'fallback_{name}.csv', inputs.flats.gnaf_id, 1200)


def test_full_size_synthetic_m0(tmp_path):
    config = deepcopy(load_config())
    config['paths'] = {key: tmp_path / key for key in config['paths']}
    report = run(config, data='synthetic', model='m0')
    ids = pd.read_csv(config['paths']['raw'] / 'synthetic' / config['files']['flats']).gnaf_id
    result = check_submission(report['run']['submission'], ids)
    assert result['rows'] == 65777
    assert report['run']['elapsed_seconds'] < 120
