import sys
import pickle
import json
import os
import pandas as pd
import numpy as np

try:
    import xgboost  # Ensure xgboost is imported
except ModuleNotFoundError:
    print(json.dumps({'error': 'Required module xgboost is not installed. Please install it using "pip install xgboost".'}), file=sys.stderr)
    sys.exit(1)

# Get the absolute path to the model file
model_path = os.path.join(os.path.dirname(__file__), 'Model', 'xgb_model.pkl')

# Check if the model file exists
if not os.path.exists(model_path):
    print(json.dumps({'error': f'Model file not found at {model_path}'}), file=sys.stderr)
    sys.exit(1)

# Load the model
with open(model_path, 'rb') as f:
    model = pickle.load(f)

# Get inputs from command-line arguments
ticker = sys.argv[1]
start_date = sys.argv[2]

# Preprocess inputs into the expected feature format
try:
    # Convert ticker to a numerical or categorical value (example: hash the string)
    ticker_numeric = abs(hash(ticker)) % (10**8)

    # Convert start_date to a numerical value (example: days since epoch)
    start_date_numeric = (pd.to_datetime(start_date) - pd.Timestamp("1970-01-01")) // pd.Timedelta("1D")

    # Example preprocessing: Replace this with the actual preprocessing logic
    # Assuming the model expects a DataFrame with 10 features
    features = {
        'ticker': ticker_numeric,
        'start_date': start_date_numeric,
        # Add other required features with default or derived values
        'feature_1': 0,
        'feature_2': 0,
        'feature_3': 0,
        'feature_4': 0,
        'feature_5': 0,
        'feature_6': 0,
        'feature_7': 0,
        'feature_8': 0
    }
    input_data = pd.DataFrame([features])
except Exception as e:
    print(json.dumps({'error': f'Failed to preprocess inputs: {str(e)}'}), file=sys.stderr)
    sys.exit(1)

# Make prediction
try:
    prediction = model.predict(input_data)
    print(json.dumps({'ticker': ticker, 'start_date': start_date, 'prediction': prediction.tolist()}))
except Exception as e:
    print(json.dumps({'error': str(e)}), file=sys.stderr)
    sys.exit(1)
