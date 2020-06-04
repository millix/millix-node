#!/usr/bin/env bash
docker build -t millix/millix-node . && docker run --name millix-node millix/millix-node
