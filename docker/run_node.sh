#!/bin/sh
echo "updating source code..."
git pull
echo "running on localhost:$MILLIX_NODE_PORT"
echo $MILLIX_NODE_PASSWORD|babel-node --inspect=0.0.0.0:30009 --max-old-space-size=8192 index.js --port $MILLIX_NODE_PORT --api-port $MILLIX_NODE_PORT_API --debug --folder $MILLIX_NODE_DATA_FOLDER
