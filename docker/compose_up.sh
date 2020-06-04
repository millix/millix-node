#!/usr/bin/env bash
NODE_SCALE="${1:-1}"
for i in $(seq 1 $NODE_SCALE); do \
  COMPOSE_PROJECT_NAME=millix MILLIX_NODE_PORT=$((30000 + $i - 1)) \
  MILLIX_NODE_PORT_API=$((5500 + $i - 1)) docker-compose up --no-recreate --scale millix-node=$i -d; \
done
