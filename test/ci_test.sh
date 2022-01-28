#!/bin/bash
set -eux

cd test
pip install pytest pytest-parallel selenium
webpack --mode production
python server.py &
TEST_SERVER_PORT=8001 TEST_SERVER_HTTPS=1 python server.py &
pytest --tests-per-worker 6 test.py
