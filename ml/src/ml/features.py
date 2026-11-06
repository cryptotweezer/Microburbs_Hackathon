"""Historical feature snapshots, with all lease aggregates strictly before cutoff."""
import numpy as np
import pandas as pd


def month_number(dates):
    dates = pd.DatetimeIndex(dates)
    return np.asarray((dates.year - 2018) * 12 + dates.month - 1, dtype=float)


def lookup(table, rows, keys, default=np.nan):
    index = pd.MultiIndex.from_frame(rows[keys]) if len(keys) > 1 else pd.Index(rows[keys[0]])
    return pd.Series(table.reindex(index).to_numpy(), index=rows.index).fillna(default)


def safe_flats(flats, cutoff, block_stats_as_of, mask_post_cutoff_attributes=False):
    result = flats.copy()
    if mask_post_cutoff_attributes:
        unavailable = result.attrs_last_seen.isna() | (result.attrs_last_seen >= pd.Timestamp(cutoff))
        for col in ['bedrooms', 'bathrooms', 'car_spaces', 'floor_level', 'flats_in_building']:
            result.loc[unavailable, col] = np.nan
    if pd.Timestamp(block_stats_as_of) > pd.Timestamp(cutoff):
        result[['block_new_homes_2021_2026', 'block_homes_2026']] = np.nan
    result['building_address'] = result.building_address.fillna('missing:' + result.gnaf_id)
    result['suburb'] = result.suburb.fillna('Unknown')
    return result


class FeatureStore:
    def __init__(self, flats, leases, cutoff, block_stats_as_of='2026-07-31', mask_post_cutoff_attributes=False):
        self.cutoff = pd.Timestamp(cutoff)
        self.flats = safe_flats(flats, self.cutoff, block_stats_as_of, mask_post_cutoff_attributes)
        history = leases.loc[leases.date < self.cutoff].copy()
        history = history.merge(self.flats[['gnaf_id', 'building_address', 'suburb', 'bedrooms', 'bathrooms']],
                                on='gnaf_id', how='inner', suffixes=('', '_flat'), validate='many_to_one')
        for col in ['bedrooms', 'bathrooms']:
            history[col] = history[col].fillna(history[col + '_flat'])
        history['bedrooms'] = history.bedrooms.fillna(1)
        history['parking'] = history.car_spaces.clip(0, 1).fillna(-1)
        history['month'] = month_number(history.date)
        self.cutoff_month = month_number([self.cutoff])[0]
        self.slopes = {}
        for bed, group in history.groupby('bedrooms'):
            recent = group.loc[group.month >= self.cutoff_month - 36]
            medians = recent.groupby('month').rent.median()
            slope = np.polyfit(medians.index.to_numpy(), np.log(medians.to_numpy()), 1)[0] if len(medians) >= 6 else 0.
            self.slopes[bed] = float(np.clip(slope, -.015, .015))
        history['rent_now'] = history.rent * np.exp(history.bedrooms.map(self.slopes).fillna(0) * (self.cutoff_month - history.month))
        self.history_max_date = history.date.max()
        known = history.loc[history.parking >= 0]
        # Within-group differences prevent broad bedroom/suburb mix from defining parking value.
        self.premiums = []
        for keys in [['bedrooms'], ['suburb', 'bedrooms'], ['building_address', 'bedrooms']]:
            grouped = known.groupby(keys + ['parking']).rent_now.agg(['median', 'count'])
            med = grouped['median'].unstack('parking').reindex(columns=[0., 1.])
            count = grouped['count'].unstack('parking').reindex(columns=[0., 1.]).fillna(0).min(axis=1)
            diff = (med[1.] - med[0.]).clip(lower=0, upper=400)
            self.premiums.append((keys, diff, count))
        history['premium'] = self.parking_premium(history)
        history['rent_zero'] = history.rent_now - history.premium * history.parking.replace(-1, .5)
        self.global_rent = float(history.rent_now.median()) if len(history) else 600.
        self.zero_global = float(history.rent_zero.median()) if len(history) else 570.
        self.hierarchy = []
        for keys in [['building_address', 'bedrooms', 'parking'], ['suburb', 'bedrooms', 'parking'], ['bedrooms']]:
            self.hierarchy.append((keys, history.groupby(keys).rent_now.median()))
        self.building = history.groupby(['building_address', 'bedrooms']).rent_zero.agg(['median', 'count'])
        self.suburb = history.groupby(['suburb', 'bedrooms']).rent_zero.median()
        self.city = history.groupby('bedrooms').rent_zero.median()
        self.last = history.sort_values(['date', 'gnaf_id', 'rent']).drop_duplicates('gnaf_id', keep='last').set_index('gnaf_id')
        self.own_counts = history.groupby('gnaf_id').size()
        self.suburb_codes = {value: i for i, value in enumerate(sorted(self.flats.suburb.unique()))}

    def parking_premium(self, rows):
        value = pd.Series(55., index=rows.index)
        for keys, diff, count in self.premiums:
            local = lookup(diff, rows, keys)
            n = lookup(count, rows, keys, 0)
            weight = n / (n + 10)
            value = (local.fillna(value) * weight + value * (1 - weight)).clip(lower=0)
        return value

    def transform(self, query, horizon):
        # Query can override target attributes using the advertised lease, never its rent.
        rows = query[['gnaf_id']].merge(self.flats, on='gnaf_id', how='left', validate='many_to_one')
        for col in ['bedrooms', 'bathrooms', 'car_spaces']:
            if col in query:
                rows[col] = query[col].to_numpy()
        rows['bedrooms'] = rows.bedrooms.fillna(rows.gnaf_id.map(self.last.bedrooms)).fillna(1)
        rows['bathrooms'] = rows.bathrooms.fillna(rows.gnaf_id.map(self.last.bathrooms))
        rows['parking'] = rows.car_spaces.clip(0, 1).fillna(-1)
        dates = pd.DatetimeIndex(horizon if not isinstance(horizon, (str, pd.Timestamp)) else [horizon] * len(rows))
        months = month_number(dates)
        growth = np.exp(rows.bedrooms.map(self.slopes).fillna(0) * (months - self.cutoff_month))
        premium = self.parking_premium(rows)
        target_parking = rows.parking.replace(-1, .5)
        m0 = pd.Series(np.nan, index=rows.index)
        for keys, table in self.hierarchy:
            m0 = m0.fillna(lookup(table, rows, keys))
        m0 = m0.fillna(self.global_rent) * growth
        keys = ['building_address', 'bedrooms']
        building = lookup(self.building['median'], rows, keys)
        count = lookup(self.building['count'], rows, keys, 0)
        suburb = lookup(self.suburb, rows, ['suburb', 'bedrooms'])
        city = lookup(self.city, rows, ['bedrooms'])
        building = building.fillna(suburb).fillna(city).fillna(self.zero_global)
        own = rows.gnaf_id.map(self.last.rent_zero)
        own_date = pd.to_datetime(rows.gnaf_id.map(self.last.date))
        own_n = rows.gnaf_id.map(self.own_counts).fillna(0)
        weight = own_n / (own_n + 10)
        # Shrink a sparse repeat-lease estimate toward the local building estimate.
        repeat = own.fillna(building)
        m1 = (weight * repeat + (1 - weight) * building + premium * target_parking) * growth
        result = rows[['bedrooms', 'bathrooms', 'floor_level', 'flats_in_building', 'latitude', 'longitude',
                       'block_new_homes_2021_2026', 'block_homes_2026']].copy()
        result['parking'] = rows.parking
        result['parking_known'] = (rows.parking >= 0).astype(int)
        result['has_own_history'] = own.notna().astype(int)
        result['own_last_rent'] = own * growth
        result['own_n'] = own_n
        result['own_age_days'] = (pd.Series(dates, index=rows.index) - own_date).dt.days
        result['building_median'] = building * growth
        result['building_n'] = count
        result['suburb_median'] = suburb * growth
        result['city_median'] = city * growth
        result['parking_premium'] = premium * growth
        result['monthly_time_index'] = growth
        result['target_month'] = months
        result['suburb_code'] = rows.suburb.map(self.suburb_codes)
        result['m0'] = m0
        result['m1'] = m1
        return result.replace([np.inf, -np.inf], np.nan).astype(float)


if __name__ == '__main__':
    import argparse
    from .config import load_config
    from .ingest import load_inputs
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', choices=['synthetic', 'real'], default='synthetic')
    parser.add_argument('--cutoff', help='Optional earlier feature cutoff')
    args = parser.parse_args()
    config = load_config()
    cutoff = args.cutoff or config['cutoff']
    if pd.Timestamp(cutoff) > pd.Timestamp(config['cutoff']):
        raise ValueError('Feature cutoff exceeds the configured data cutoff')
    inputs = load_inputs(config, args.data)
    store = FeatureStore(inputs.flats, inputs.leases, cutoff, config['block_stats_as_of'], config.get('mask_post_cutoff_attributes', False))
    result = store.transform(inputs.flats[['gnaf_id']], config['horizon'])
    result.insert(0, 'gnaf_id', inputs.flats.gnaf_id.to_numpy())
    output = config['paths']['artifacts'] / 'features.csv'
    output.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(output, index=False)
    print(f'Wrote {len(result):,} feature rows to {output}; latest lease source: {store.history_max_date}')
