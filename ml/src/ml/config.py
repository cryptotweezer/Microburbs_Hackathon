"""Configuration paths are relative to the YAML file, never the working directory."""
from pathlib import Path
import yaml
import pandas as pd


def load_config(path=None):
    path = Path(path or Path(__file__).resolve().parents[2] / 'config.yaml').resolve()
    config = yaml.safe_load(path.read_text(encoding='utf-8'))
    if pd.Timestamp(config['cutoff']) > pd.Timestamp('2026-07-31'):
        raise ValueError('The modelling cutoff cannot exceed 2026-07-31')
    if pd.Timestamp(config['horizon']) <= pd.Timestamp(config['cutoff']):
        raise ValueError('The prediction horizon must follow the modelling cutoff')
    config['paths'] = {k: (path.parent / v).resolve() for k, v in config['paths'].items()}
    return config
