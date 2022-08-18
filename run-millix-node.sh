#!/bin/sh
ip_address=127.0.0.1
echo "running on $ip_address"
./node_modules/@babel/node/bin/babel-node.js --max-old-space-size=2048 index.js --host $ip_address
